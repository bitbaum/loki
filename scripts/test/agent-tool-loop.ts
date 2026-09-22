/**
 * Loki's in-app tool loop — protocol parsing and loop control.
 * Run: npx tsx scripts/test/agent-tool-loop.ts
 *
 * Env-independent by construction: the model call and the seed context are both
 * injected, so this needs no GROQ_API_KEY and no DATABASE_URL. That is the point
 * — loop control (round budgets, fact accumulation, bad-argument recovery,
 * whether a repair may make an answer worse) is the part most likely to break,
 * and a live-model test can never pin it down because the model chooses
 * differently every run.
 *
 * The parser cases are not invented. Each is a shape a small model actually
 * emits when asked to call a tool: markdown-bolded keys, fenced ARGS, a name
 * copied with its parentheses, a bare no-argument call, and — most importantly —
 * a call narrated in prose while native tool-calling was enabled. Under a
 * native-only parser that last one reaches the user as a hallucinated result.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { parseTextToolCalls, stripToolCallLines, type ModelTurn } from "../../src/lib/agent/llm";
import {
  defineTool,
  renderToolCatalog,
  toOpenAITools,
  type ToolRegistry,
} from "../../src/lib/agent/tools/registry";
import { runLokiTurn } from "../../src/lib/agent/loop";
import { makeFact, assignFactIds } from "@bitbaum/ai-kit/grounding";

const NAMES = ["search_people", "list_projects", "propose_action"];

// ── 1. The text protocol survives how small models actually write ────────────
{
  const plain = parseTextToolCalls('TOOL: search_people\nARGS: {"query": "Elena"}', NAMES);
  assert.equal(plain.length, 1, "the documented shape must parse");
  assert.deepEqual(plain[0].args, { query: "Elena" });

  const bolded = parseTextToolCalls('**TOOL:** search_people\n**ARGS:** {"query": "Elena"}', NAMES);
  assert.equal(bolded.length, 1, "markdown-bolded keys must parse");

  const parens = parseTextToolCalls('TOOL: search_people(query)\nARGS: {"query": "Ilya"}', NAMES);
  assert.equal(parens[0]?.args.query, "Ilya", "a name copied with parens must still resolve");

  const noArgs = parseTextToolCalls("TOOL: list_projects", NAMES);
  assert.equal(noArgs.length, 1, "a no-argument call needs no ARGS line");
  assert.deepEqual(noArgs[0].args, {}, "missing ARGS means empty args, not failure");

  const fenced = parseTextToolCalls(
    'TOOL: search_people\nARGS: ```json\n{"query": "Elena"}\n```',
    NAMES,
  );
  assert.equal(fenced[0]?.args.query, "Elena", "fenced ARGS must parse");

  const trailing = parseTextToolCalls(
    'TOOL: search_people\nARGS: {"query": "Elena"} — then I will summarise',
    NAMES,
  );
  assert.equal(
    trailing[0]?.args.query,
    "Elena",
    "commentary after the JSON must not break the parse",
  );

  const multi = parseTextToolCalls(
    'TOOL: list_projects\nTOOL: search_people\nARGS: {"query": "Elena"}',
    NAMES,
  );
  assert.equal(multi.length, 2, "two calls in one reply must both parse");
  assert.deepEqual(multi[0].args, {}, "a call followed by another TOOL line has no args");

  // A name that is not registered must never be dispatched — the parser is the
  // closed-set boundary, not the executor.
  assert.equal(
    parseTextToolCalls("TOOL: rm_rf_everything\nARGS: {}", NAMES).length,
    0,
    "unknown tools must not parse",
  );
}

// ── 2. Narrated calls never reach the operator as prose ──────────────────────
{
  const raw =
    'Let me look her up.\nTOOL: search_people\nARGS: {"query": "Elena"}\nI will report back.';
  const stripped = stripToolCallLines(raw);
  assert.doesNotMatch(stripped, /TOOL:/, "tool lines must be stripped from prose");
  assert.doesNotMatch(stripped, /ARGS:/, "args lines must be stripped from prose");
  assert.match(stripped, /Let me look her up/, "the model's actual prose must survive");
}

// ── Scripted-model harness ───────────────────────────────────────────────────
/** Returns each scripted turn in order; records what it was asked. */
function scriptedModel(turns: Array<Partial<ModelTurn>>) {
  let i = 0;
  const seen: Array<{ toolsAdvertised: number }> = [];
  const fn = async (input: { tools: Array<Record<string, unknown>> }): Promise<ModelTurn> => {
    seen.push({ toolsAdvertised: input.tools.length });
    const t = turns[Math.min(i, turns.length - 1)];
    i++;
    return { text: t.text ?? "", toolCalls: t.toolCalls ?? [], model: "stub" };
  };
  return { fn: fn as never, seen, calls: () => i };
}

const STUB_REGISTRY: ToolRegistry = {
  search_people: defineTool({
    name: "search_people",
    kind: "read",
    description: "stub",
    params: z.object({ query: z.string() }),
    example: 'TOOL: search_people\nARGS: {"query": "x"}',
    handler: async ({ query }) =>
      query === "nobody"
        ? { facts: [], note: `No contact matched "${query}".` }
        : {
            facts: [
              makeFact({
                kind: "person",
                subject: "Elena Weber SINGA Switzerland",
                source: "people table",
                values: {
                  name: "Elena Weber SINGA Switzerland",
                  channels: "whatsapp +41774730093",
                },
              }),
            ],
          },
  }),
  boom: defineTool({
    name: "boom",
    kind: "read",
    description: "stub that throws",
    params: z.object({}),
    example: "TOOL: boom\nARGS: {}",
    handler: async () => {
      throw new Error("upstream exploded");
    },
  }),
};

const SEED = { facts: [], directives: [] };

async function main() {
  // The real registry lives beside handlers that import @/db, which throws at
  // module init without a connection string. A parseable dummy is enough: these
  // assertions only read tool METADATA (names, kinds, examples) and never invoke
  // a handler, so no connection is ever opened. Keeping the import lazy is what
  // lets this suite stay in the env-independent tier.
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";
  const { LOKI_TOOLS } = await import("../../src/lib/agent/tools/handlers");

  // ── 3. The catalog shows a COPYABLE example for every tool ───────────────────
  // Measured on this fleet: a field shown as a copyable line is emitted correctly
  // ~97% of the time; the same rule in prose, ~3%. A tool without an example is a
  // tool weak models will call wrongly, so this is asserted, not trusted.
  {
    const catalog = renderToolCatalog(LOKI_TOOLS);
    for (const name of Object.keys(LOKI_TOOLS)) {
      assert.ok(catalog.includes(`### ${name}`), `${name} must appear in the catalog`);
      assert.ok(catalog.includes(`TOOL: ${name}`), `${name} must ship a copyable example call`);
    }
    // The propose tool must be visibly marked as needing approval.
    assert.match(catalog, /propose_action {2}\(proposes a draft — needs the operator's approval\)/);

    // Native specs must advertise exactly the same set — drift here would let a
    // model call something the executor does not have.
    const native = toOpenAITools(LOKI_TOOLS)
      .map((t) => (t.function as { name: string }).name)
      .sort();
    assert.deepEqual(
      native,
      Object.keys(LOKI_TOOLS).sort(),
      "native specs must match the registry exactly",
    );
  }

  // ── 4. Loki has NO tool that acts directly ───────────────────────────────────
  // The safety boundary is structural: read or propose, never execute. If someone
  // adds an executing tool this fails, which is the intent.
  {
    const kinds = new Set(Object.values(LOKI_TOOLS).map((t) => t.kind));
    assert.deepEqual(
      [...kinds].sort(),
      ["propose", "read"],
      "only read and propose kinds may exist",
    );
    assert.equal(LOKI_TOOLS.propose_action.kind, "propose");
  }

  // ── 5. Tool results become facts the answer can cite ─────────────────────────
  {
    const model = scriptedModel([
      { toolCalls: [{ id: "1", name: "search_people", args: { query: "Elena" } }] },
      { text: "Elena Weber SINGA Switzerland — whatsapp +41774730093 [F1]." },
    ]);
    const r = await runLokiTurn({
      userId: "u1",
      message: "who is Elena?",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: SEED,
    });
    assert.deepEqual(r.toolsUsed, ["search_people"], "the tool must have executed");
    assert.equal(r.facts.length, 1, "the tool's records must land in the fact set");
    assert.equal(r.facts[0].id, "F1", "facts must be citable");
    assert.deepEqual(
      r.violations,
      [],
      `a grounded answer must verify clean: ${JSON.stringify(r.violations)}`,
    );
    assert.equal(r.rounds, 2, "one gather round then one answer round");
  }

  // ── 6. An invented attribute is caught even when the tool ran ────────────────
  // The whole point of routing tools through Facts: calling the right tool does
  // not license adding a field the record never had.
  {
    const model = scriptedModel([
      { toolCalls: [{ id: "1", name: "search_people", args: { query: "Elena" } }] },
      { text: "Elena Weber is Program Manager at Impact Hub Zurich [F1]." },
      { text: `Elena Weber SINGA Switzerland [F1]. Her role is not recorded.` },
    ]);
    const r = await runLokiTurn({
      userId: "u1",
      message: "who is Elena?",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: SEED,
    });
    assert.ok(
      r.violations.length === 0 || !/Impact Hub/i.test(r.text),
      "an invented employer must be repaired away or flagged, never served clean",
    );
    assert.doesNotMatch(r.text, /Impact Hub/i, "the repair pass must have removed the fabrication");
  }

  // ── 7. Empty tool results are reported, not papered over ─────────────────────
  {
    const model = scriptedModel([
      { toolCalls: [{ id: "1", name: "search_people", args: { query: "nobody" } }] },
      { text: "Not in your data." },
    ]);
    const r = await runLokiTurn({
      userId: "u1",
      message: "who is nobody?",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: SEED,
    });
    assert.equal(r.facts.length, 0, "an empty tool result adds no facts");
    assert.match(r.text, /Not in your data/, "the refusal must survive to the operator");
  }

  // ── 8. A throwing tool reads as UNKNOWN, never as "none" ─────────────────────
  {
    const model = scriptedModel([
      { toolCalls: [{ id: "1", name: "boom", args: {} }] },
      { text: "That lookup failed, so I cannot say." },
    ]);
    const r = await runLokiTurn({
      userId: "u1",
      message: "check the thing",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: SEED,
    });
    assert.equal(r.facts.length, 0, "a failed tool contributes no facts");
    assert.ok(r.text.length > 0, "a failed tool must not fail the turn");
  }

  // ── 9. Bad arguments get the example back, not a zod dump ────────────────────
  {
    const model = scriptedModel([
      { toolCalls: [{ id: "1", name: "search_people", args: { wrong: 1 } }] },
      { toolCalls: [{ id: "2", name: "search_people", args: { query: "Elena" } }] },
      { text: "Elena Weber SINGA Switzerland [F1]." },
    ]);
    const r = await runLokiTurn({
      userId: "u1",
      message: "who is Elena?",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: SEED,
    });
    assert.deepEqual(
      r.toolsUsed,
      ["search_people"],
      "the malformed call must not count as executed",
    );
    assert.equal(r.facts.length, 1, "the corrected retry must succeed");
  }

  // ── 10. The loop is bounded, and the last round cannot call tools ────────────
  // A model that only ever calls tools must still terminate WITH an answer —
  // otherwise a weak model's loop becomes a hung request.
  {
    const model = scriptedModel([
      { toolCalls: [{ id: "1", name: "search_people", args: { query: "Elena" } }] },
      { toolCalls: [{ id: "2", name: "search_people", args: { query: "Elena" } }] },
      { text: "Elena Weber SINGA Switzerland [F1]." },
    ]);
    const r = await runLokiTurn({
      userId: "u1",
      message: "who is Elena?",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: SEED,
    });
    assert.ok(r.rounds <= 3, `the loop must be bounded, ran ${r.rounds} rounds`);
    assert.ok(r.text.length > 0, "the loop must always end with text");
    assert.equal(
      model.seen[model.seen.length - 1].toolsAdvertised,
      0,
      "the final round must advertise NO tools so the model is forced to answer",
    );
  }

  // ── 11. A too-large prompt sheds facts instead of abandoning the loop ────────
  // Observed in production: the big model rate-limited, the 429 handler stepped
  // down to the 8B model as designed, and the 8B model then returned 413 because
  // a prompt sized for a 128k context does not fit a small one. The loop gave up
  // and fell back to weaker retrieval, so the step-down achieved nothing.
  {
    const manyFacts = assignFactIds(
      Array.from({ length: 40 }, (_, i) =>
        makeFact({
          kind: "project",
          subject: `proj-${i}`,
          source: "projects table",
          values: { name: `proj-${i}` },
        }),
      ),
    );
    const sizes: number[] = [];
    let calls = 0;
    const model = (async (input: { messages: Array<{ content: string }> }) => {
      calls++;
      // Count rendered records to observe the shed.
      sizes.push((input.messages[1]?.content.match(/^\[F\d+\]/gm) ?? []).length);
      if (calls <= 2) throw new Error("groq 413: Request too large for model");
      return { text: "Answered with what fits.", toolCalls: [], model: "stub" };
    }) as never;

    const r = await runLokiTurn({
      userId: "u1",
      message: "what am I working on?",
      registry: STUB_REGISTRY,
      callModel: model,
      seed: { facts: manyFacts, directives: [] },
    });
    assert.equal(r.text, "Answered with what fits.", "a 413 must not fail the turn");
    assert.ok(sizes.length >= 3, `expected retries, saw ${sizes.length} attempt(s)`);
    assert.ok(sizes[1] < sizes[0], `facts must shrink on 413: ${sizes.join(" -> ")}`);
    assert.ok(sizes[2] < sizes[1], `facts must shrink again: ${sizes.join(" -> ")}`);

    // A non-413 error must NOT be retried — retrying a 401 or a 500 just burns
    // the operator's latency for a guaranteed second failure.
    let other = 0;
    const failing = (async () => {
      other++;
      throw new Error("groq 401: invalid api key");
    }) as never;
    await runLokiTurn({
      userId: "u1",
      message: "hi",
      registry: STUB_REGISTRY,
      callModel: failing,
      seed: { facts: manyFacts, directives: [] },
    }).then(
      () => assert.fail("a 401 must propagate"),
      () => assert.equal(other, 1, "a non-413 error must not be retried"),
    );
  }

  // ── 12. Conversation history reaches the model ──────────────────────────────
  // Before 2026-09-11 the loop received only the current message. The gateway
  // FALLBACK carried memory (per session key), so thread continuity appeared
  // and disappeared depending on which brain served the turn, and nothing in
  // the UI said which. "And the second one?" was answered cold.
  {
    const seenMessages: Array<Array<{ role: string; content: string }>> = [];
    const model = (async (input: { messages: Array<{ role: string; content: string }> }) => {
      seenMessages.push(input.messages);
      return { text: "The second report was about the header.", toolCalls: [], model: "stub" };
    }) as never;

    await runLokiTurn({
      userId: "u1",
      message: "and the second one?",
      registry: STUB_REGISTRY,
      callModel: model,
      seed: SEED,
      history: [
        { role: "user", content: "what feedback came in today?" },
        { role: "assistant", content: "Two reports: one on /control, one on /en/." },
      ],
    });

    const roles = seenMessages[0].map((m) => m.role);
    const joined = seenMessages[0].map((m) => m.content).join("\n");
    assert.match(joined, /what feedback came in today/, "the prior question must reach the model");
    assert.match(joined, /Two reports/, "the prior answer must reach the model");
    assert.equal(roles[0], "system", "the system prompt stays first");
    assert.ok(
      roles.indexOf("assistant") < roles.lastIndexOf("user"),
      `history must precede the current question, got [${roles.join(", ")}]`,
    );
  }

  {
    // History is trimmed, not trusted: a pasted wall of text must not crowd out
    // the records, which are the part that makes the answer true.
    const seenMessages: Array<Array<{ role: string; content: string }>> = [];
    const model = (async (input: { messages: Array<{ role: string; content: string }> }) => {
      seenMessages.push(input.messages);
      return { text: "ok", toolCalls: [], model: "stub" };
    }) as never;

    await runLokiTurn({
      userId: "u1",
      message: "and?",
      registry: STUB_REGISTRY,
      callModel: model,
      seed: SEED,
      history: Array.from({ length: 30 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: "x".repeat(5000),
      })),
    });

    const priorTurns = seenMessages[0].filter((m) => m.content.startsWith("x"));
    assert.ok(priorTurns.length <= 8, `history must be capped, got ${priorTurns.length} turns`);
    for (const turn of priorTurns) {
      assert.ok(
        turn.content.length <= 601,
        `each prior turn must be trimmed, got ${turn.content.length} chars`,
      );
    }
  }

  // ── 13. An unsendable prompt THROWS — it is never sent empty ────────────────
  // The production failure, exactly: the fixed overhead exceeded the whole
  // budget, the fit honestly returned zero facts, and the turn was sent anyway
  // with an empty Records block. The model then said "Not in your data." about
  // records that existed, and the sentence was true of what it had been given.
  // A caller that cannot see anything must fail loudly so the fallback runs.
  {
    const facts = assignFactIds(
      Array.from({ length: 10 }, (_, i) =>
        makeFact({
          kind: "project",
          subject: `p${i}`,
          source: "projects table",
          values: { name: `p${i}` },
        }),
      ),
    );
    let called = 0;
    const model = (async () => {
      called++;
      return { text: "answered from nothing", toolCalls: [], model: "stub" };
    }) as never;

    await runLokiTurn({
      userId: "u1",
      message: "what am I working on?",
      registry: STUB_REGISTRY,
      callModel: model,
      seed: { facts, directives: [] },
      // Smaller than the system prompt alone: nothing can fit.
      promptBudgetTokens: 10,
    }).then(
      () => assert.fail("a prompt that cannot carry a single record must not be sent"),
      (e: Error) => {
        assert.match(e.message, /overhead/i, `expected an overhead error, got: ${e.message}`);
        assert.equal(called, 0, "the model must not be called with an empty Records block");
      },
    );
  }

  // ── 14. A repair that invents something NEW is rejected ─────────────────────
  // Fewer violations is not enough. Swapping "Program Manager at Impact Hub
  // Zurich" for "Director at Seedstars Geneva" uses fewer proper nouns and
  // passes a count test while being just as invented. A repair is a DELETION:
  // every flagged span in the result must already have been flagged.
  {
    const model = scriptedModel([
      { toolCalls: [{ id: "1", name: "search_people", args: { query: "Elena" } }] },
      { text: "Elena Weber is Program Manager at Impact Hub Zurich and Basel [F1]." },
      // The "repair" drops one fabrication and introduces a different one.
      { text: "Elena Weber is Director at Seedstars Geneva [F1]." },
    ]);
    const r = await runLokiTurn({
      userId: "u1",
      message: "who is Elena?",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: SEED,
    });
    assert.doesNotMatch(
      r.text,
      /Seedstars/i,
      "a repair that invents a NEW unsupported claim must be rejected, not accepted for being shorter",
    );
    assert.ok(
      r.violations.length > 0,
      "the original's violations must be reported rather than silently swapped",
    );
  }

  // ── 15. The turn reports what it retrieved ──────────────────────────────────
  // Provenance the operator can see: which sources produced how many records.
  // Without it, a thin answer is indistinguishable from a thin database.
  {
    const model = scriptedModel([{ text: "You have two projects." }]);
    const r = await runLokiTurn({
      userId: "u1",
      message: "what am I working on?",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: {
        facts: [],
        directives: [],
        retrieved: [
          { source: "projects", count: 2 },
          { source: "feedback", count: 0 },
        ],
      },
    });
    assert.deepEqual(
      r.retrieved,
      [
        { source: "projects", count: 2 },
        { source: "feedback", count: 0 },
      ],
      "the loop must pass the seed's retrieval report through to the caller",
    );
  }

  console.log(
    "✓ agent tool loop: 17 checks passed (protocol tolerance, catalog shape, no-execute boundary, fact accumulation, repair guards, bounds, 413 shedding, history, empty-prompt refusal, provenance, advertised-vs-callable)",
  );
}

// ── 16-17. Advertising fewer tools must not remove any ──────────────────────
// The catalogue costs 3,010 tokens per turn before a single record, which is
// why Groq's 8,000-token window is skipped on every call. Narrowing what the
// model SEES buys that back; narrowing what it may CALL would be a capability
// cut wearing the same clothes. These two pin the difference.

async function advertisingChecks() {
  const seen: Array<{ advertised: number; accepted: string[] }> = [];
  let turn = 0;
  const model = (async (input: { tools: unknown[]; validToolNames: string[] }) => {
    seen.push({ advertised: input.tools.length, accepted: [...input.validToolNames] });
    // First reply calls a tool that was deliberately NOT advertised this turn.
    turn += 1;
    return turn === 1
      ? {
          text: "",
          toolCalls: [{ id: "1", name: "search_people", args: { query: "Elena" } }],
          model: "stub",
        }
      : { text: "Elena Weber SINGA Switzerland [F1].", toolCalls: [], model: "stub" };
  }) as never;

  const r = await runLokiTurn({
    userId: "u1",
    message: "who is Elena?",
    registry: STUB_REGISTRY,
    callModel: model,
    seed: {
      facts: [],
      directives: [],
      // Advertise ONLY `boom`, so search_people is hidden from the catalogue.
      advertiseTools: new Set(["boom"]),
    },
  });

  assert.equal(
    seen[0]?.advertised,
    1,
    `only the advertised tool is shown, saw ${seen[0]?.advertised}`,
  );
  assert.deepEqual(
    seen[0]?.accepted.sort(),
    Object.keys(STUB_REGISTRY).sort(),
    "the ACCEPTED set stays the whole registry — narrowing it would be the capability cut",
  );
  assert.deepEqual(
    r.toolsUsed,
    ["search_people"],
    "an unadvertised tool the model named must still EXECUTE",
  );

  // And with no advertising hint, nothing narrows.
  const seenAll: number[] = [];
  const modelAll = (async (input: { tools: unknown[] }) => {
    seenAll.push(input.tools.length);
    return { text: "fine", toolCalls: [], model: "stub" };
  }) as never;
  await runLokiTurn({
    userId: "u1",
    message: "hi",
    registry: STUB_REGISTRY,
    callModel: modelAll,
    seed: { facts: [], directives: [] },
  });
  assert.equal(
    seenAll[0],
    Object.keys(STUB_REGISTRY).length,
    "no hint means advertise everything — a test's own seed must not be narrowed",
  );
}

// ── The model's PLAN must never be served as the answer ─────────────────────
// The fallback path got this guard after gpt-oss-20b spent a whole budget
// writing "We need to answer: ... Let's go through each:". The tool loop —
// which serves nearly every turn, and whose second link is that same model —
// did not have it. Grounding cannot cover the gap: a plan asserts nothing, so
// it passes every rule in verifyAnswer while telling the operator nothing.
async function planAsAnswerChecks() {
  const PLAN =
    "We need to answer: which projects are live. We must cite each claim. " +
    "Let's go through each record in turn.";
  const GOOD = "Elena Weber SINGA Switzerland [F1].";

  {
    const model = scriptedModel([{ text: PLAN }, { text: GOOD }]);
    const r = await runLokiTurn({
      userId: "u1",
      message: "who is Elena?",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: SEED,
    });
    assert.doesNotMatch(r.text, /we need to answer/i, "the plan must not reach the operator");
    assert.match(r.text, /Elena Weber/, `the retry's answer must be served: ${r.text}`);
    assert.equal(model.calls(), 2, "exactly one retry — not a loop");
  }

  // A second plan is not an improvement. Retrying forever would burn a
  // rate-limited free tier on a model that has shown it will not comply.
  {
    const model = scriptedModel([{ text: PLAN }, { text: PLAN }]);
    const r = await runLokiTurn({
      userId: "u1",
      message: "who is Elena?",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: SEED,
    });
    assert.equal(model.calls(), 2, "one retry only, even when the retry is also a plan");
    assert.ok(r.text.length > 0, "a turn must still return something");
  }

  // An EMPTY retry is worse than a plan: at least a plan shows the model read
  // the question. Keep the first reply rather than serving nothing.
  {
    const model = scriptedModel([{ text: PLAN }, { text: "   " }]);
    const r = await runLokiTurn({
      userId: "u1",
      message: "who is Elena?",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: SEED,
    });
    assert.ok(r.text.trim().length > 0, "an empty retry must not blank the answer");
  }

  // The common case must cost nothing: a good answer is never re-asked.
  {
    const model = scriptedModel([{ text: GOOD }]);
    await runLokiTurn({
      userId: "u1",
      message: "who is Elena?",
      registry: STUB_REGISTRY,
      callModel: model.fn,
      seed: SEED,
    });
    assert.equal(model.calls(), 1, "a normal answer must not trigger a second call");
  }

  console.log("  \u2713 the model's plan is retried, once, and never served");
}

main()
  .then(advertisingChecks)
  .then(planAsAnswerChecks)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

// Useful depth is different from repeating the same request.
async function checkInvestigationDepth() {
  let executions = 0;
  const registry: ToolRegistry = {
    inspect: defineTool({
      name: "inspect",
      kind: "propose",
      description: "test proposal",
      params: z.object({ step: z.number(), label: z.string().default("test") }),
      example: 'TOOL: inspect\nARGS: {"step":1}',
      handler: async () => {
        executions++;
        return { facts: [], note: "Recorded." };
      },
    }),
  };
  const deep = scriptedModel([
    ...[1, 2, 3, 4, 5].map((step) => ({
      toolCalls: [{ id: String(step), name: "inspect", args: { step } }],
    })),
    { text: "All five steps checked." },
  ]);
  const result = await runLokiTurn({
    userId: "u1",
    message: "Investigate",
    registry,
    seed: SEED,
    callModel: deep.fn,
  });
  assert.equal(executions, 5, "five distinct dependent steps must be reachable");
  assert.equal(result.rounds, 6);
  assert.equal(deep.seen.at(-1)?.toolsAdvertised, 0);

  executions = 0;
  const duplicate = scriptedModel([
    {
      toolCalls: [
        { id: "1", name: "inspect", args: { step: 1 } },
        { id: "2", name: "inspect", args: { label: "test", step: 1 } },
      ],
    },
    { toolCalls: [{ id: "3", name: "inspect", args: { step: 1, label: "test" } }] },
    { text: "One proposal recorded." },
  ]);
  await runLokiTurn({
    userId: "u1",
    message: "Propose",
    registry,
    seed: SEED,
    callModel: duplicate.fn,
  });
  assert.equal(
    executions,
    1,
    "same proposal must not run twice across batches, defaults or reordered keys",
  );
  assert.equal(duplicate.calls(), 3, "a repeating model should answer early");
  assert.equal(duplicate.seen.at(-1)?.toolsAdvertised, 0);
  console.log("✓ useful depth and duplicate proposal protection");
}
checkInvestigationDepth().catch((e) => {
  console.error(e);
  process.exit(1);
});
