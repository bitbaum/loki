/**
 * Prompt budgets — the arithmetic that decided whether Loki could see anything.
 * Run: npx tsx scripts/test/loki-prompt-budget.ts
 *
 * THE FAILURE THIS PINS. Every production turn on 2026-09-11 logged:
 *
 *     [loki] round 1: 40 facts exceed the call budget — sending 0
 *
 * and then answered "Not in your data." The budget was one module constant —
 * Groq's 12000-token minute window × 0.8 ÷ 3 rounds = 3200 tokens — and two
 * things were wrong with it at once:
 *
 *   1. Groq had cut the window to 8000, so the constant was stale.
 *   2. It was applied to EVERY vendor, including OpenRouter links carrying
 *      128k–1M contexts, so a prompt those would have taken whole was shed to
 *      fit a window it was never going to be sent to.
 *
 * Meanwhile the fixed overhead — system prompt ~1300 tokens plus the native
 * tool schema ~1000 — exceeded the 3200 budget on its own. So the binary
 * search for "the largest fact count that fits" correctly returned ZERO, every
 * time, silently, and the model was asked to reason about an empty page.
 *
 * Two properties are asserted here because either one alone would have let it
 * happen: the budget must come from the link that will actually serve the
 * call, and zero facts must never be sent as if it were an answer.
 *
 * Pure: no network, no database, no model.
 */
import assert from "node:assert/strict";
import {
  linkPromptBudgetTokens,
  linkPromptCeilingTokens,
  maxPromptBudgetTokens,
} from "../../src/config/chat-models";
import { fitFactsToBudget, estimateTokens } from "../../src/lib/agent/fact-budget";
import { systemPrompt } from "../../src/lib/agent/loop";
import { toOpenAITools, type ToolRegistry } from "../../src/lib/agent/tools/registry";
import {
  makeFact,
  assignFactIds,
  renderFacts,
  buildGroundedContext,
} from "@bitbaum/ai-kit/grounding";
import { byokChain } from "@bitbaum/ai-kit/byok";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const GROQ = {
  provider: { id: "groq", baseUrl: "", keyEnv: "GROQ_API_KEY", models: [], dailyTokens: 0 },
  model: "openai/gpt-oss-120b",
};
const OPENROUTER = {
  provider: {
    id: "openrouter",
    baseUrl: "",
    keyEnv: "OPENROUTER_API_KEY",
    models: [],
    dailyTokens: 0,
  },
  model: "nvidia/nemotron-3.5-lightning:free",
};

// ── 1. The budget follows the VENDOR, not a module constant ─────────────────
{
  check("Groq's budget reflects its per-minute window, not a 128k context", () => {
    const groq = linkPromptBudgetTokens(GROQ);
    assert.ok(groq > 0, "a usable Groq link must have a usable budget");
    assert.ok(
      groq < 8000,
      `Groq's prompt budget must sit under its 8000-token minute window, got ${groq}`,
    );
  });

  check("a large-context vendor is given far more room than Groq", () => {
    const groq = linkPromptBudgetTokens(GROQ);
    const or = linkPromptBudgetTokens(OPENROUTER);
    assert.ok(
      or > groq * 2,
      `OpenRouter carries 128k–1M contexts; budgeting it like Groq (${groq}) starves it: got ${or}`,
    );
  });

  check("a reader's OWN Groq key is not held to Loki's free-tier minute window", () => {
    // Built by the real producer, so the own-key marker is ai-kit's, not ours.
    const [own] = byokChain({
      vendor: "groq",
      model: "openai/gpt-oss-120b",
      apiKey: "gsk_not_a_real_key_1234",
    }).chain;
    assert.equal(own.provider.id, "groq");
    assert.equal(
      linkPromptBudgetTokens(own),
      linkPromptBudgetTokens(OPENROUTER),
      "their key's limits are their account's; sizing to the free pool only cut their context",
    );
    assert.ok(linkPromptCeilingTokens(own) > linkPromptCeilingTokens(GROQ));
  });

  check("the loop sizes against the LARGEST usable link", () => {
    const max = maxPromptBudgetTokens([GROQ, OPENROUTER]);
    assert.equal(
      max,
      linkPromptBudgetTokens(OPENROUTER),
      "sizing to the smallest link is what shed a prompt to fit a vendor it never reached",
    );
  });

  check("the SKIP bound is looser than the SIZING budget, and never above the window", () => {
    const sizing = linkPromptBudgetTokens(GROQ);
    const ceiling = linkPromptCeilingTokens(GROQ);
    assert.ok(
      ceiling > sizing,
      `skipping and sizing are different questions: a link refused costs ~1s, a link ` +
        `skipped costs ~25s and one of 50 daily requests. Got ceiling=${ceiling} sizing=${sizing}`,
    );
    assert.ok(
      ceiling < 8000,
      `the ceiling must still leave room for the reply inside the 8000-token minute ` +
        `window — the reply is charged against the same window. Got ${ceiling}`,
    );
  });

  check("a large-context vendor has no separate ceiling to be raised to", () => {
    assert.equal(
      linkPromptCeilingTokens(OPENROUTER),
      linkPromptBudgetTokens(OPENROUTER),
      "the two bounds only diverge for a per-minute-metered vendor; elsewhere a second knob is a second thing to drift",
    );
  });

  check("an operator can raise or lower either budget without a deploy", () => {
    const before = process.env.LOKI_GROQ_TPM;
    try {
      process.env.LOKI_GROQ_TPM = "30000";
      assert.ok(
        linkPromptBudgetTokens(GROQ) > 20_000,
        "LOKI_GROQ_TPM must be honoured — a vendor changing its window must be an env edit, not a release",
      );
    } finally {
      if (before === undefined) delete process.env.LOKI_GROQ_TPM;
      else process.env.LOKI_GROQ_TPM = before;
    }
  });
}

// ── 2. The overhead that ate the whole budget ───────────────────────────────
// Measured against the REGISTRY THAT SHIPS, not a stub. The whole failure was
// that the real prompt's fixed cost exceeded the real budget, and a five-tool
// stub is small enough to hide exactly that.
async function overheadChecks() {
  // handlers.ts imports @/db, which throws at module init with no connection
  // string. A parseable dummy is enough — no handler is invoked here.
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";
  const { LOKI_TOOLS: registry } = await import("../../src/lib/agent/tools/handlers");

  /** The prompt's fixed cost: system prompt + the native tool schema. */
  const fixedOverhead = (r: ToolRegistry) =>
    estimateTokens(systemPrompt(r, true)) + estimateTokens(JSON.stringify(toOpenAITools(r)));

  check("the SHIPPED prompt's fixed overhead consumes almost all of the retired budget", () => {
    const RETIRED_BUDGET = 3200;
    /** A rendered fact measured ~250 tokens across this fleet's turns. */
    const TOKENS_PER_FACT = 250;
    const overhead = fixedOverhead(registry);
    const room = RETIRED_BUDGET - overhead;
    console.log(
      `      (fixed overhead ≈ ${overhead} tokens; retired budget 3200; room left ≈ ${room} tokens ≈ ${Math.floor(room / TOKENS_PER_FACT)} fact(s))`,
    );
    assert.ok(
      room < TOKENS_PER_FACT * 2,
      `this is the bug: the prompt costs ${overhead} tokens before a single record, leaving ${room} of the retired 3200-token budget — under two facts. In production the operator's own message (a project brief and up to 2000 characters of page text are prefaced onto it) pushed it past zero, and the fit correctly returned nothing. If this ever leaves real room, the story has changed and this gate needs rereading.`,
    );
  });

  check("the native schema carries the first sentence only, not the full description", () => {
    const native = JSON.parse(JSON.stringify(toOpenAITools(registry))) as Array<{
      function: { name: string; description: string };
    }>;
    for (const spec of native) {
      const full = registry[spec.function.name]?.description ?? "";
      if (full.split(/(?<=\.)\s+/).length > 1) {
        assert.ok(
          spec.function.description.length < full.length,
          `${spec.function.name}: the native schema repeats the whole description, paying for it twice on the vendor with the smallest window`,
        );
      }
    }
  });

  check("the shipped overhead still leaves room for facts on a real vendor budget", () => {
    const overhead = fixedOverhead(registry);
    const budget = maxPromptBudgetTokens([GROQ, OPENROUTER]);
    assert.ok(
      budget - overhead > 10_000,
      `after overhead (${overhead}) the budget (${budget}) must still hold a real fact set, got ${budget - overhead} tokens of room`,
    );
  });

  check("with a real vendor budget, a full fact set FITS", () => {
    const registryForFit = registry;
    const facts = assignFactIds(
      Array.from({ length: 40 }, (_, i) =>
        makeFact({
          kind: "project",
          subject: `project-${i}`,
          source: "projects table",
          values: {
            name: `project-${i}`,
            status: "active",
            stack: "next",
            description: "x".repeat(120),
          },
        }),
      ),
    );
    const render = (f: typeof facts) =>
      buildGroundedContext({ facts: f, directives: [], renderedFacts: renderFacts(f) });
    const overheadChars =
      systemPrompt(registryForFit, true).length +
      JSON.stringify(toOpenAITools(registryForFit)).length +
      200;

    const onOldBudget = fitFactsToBudget(facts, render, overheadChars, 3200);
    const onRealBudget = fitFactsToBudget(
      facts,
      render,
      overheadChars,
      maxPromptBudgetTokens([GROQ, OPENROUTER]),
    );

    assert.ok(
      onOldBudget.length <= 1,
      `the retired 3200-token budget could carry at most one record past the shipped prompt's overhead, got ${onOldBudget.length}`,
    );
    assert.equal(
      onRealBudget.length,
      facts.length,
      `the whole fact set must fit a real vendor budget, got ${onRealBudget.length}/${facts.length}`,
    );
  });
}

// ── 3. Zero facts is never quietly sent ─────────────────────────────────────
{
  check(
    "fitFactsToBudget returning nothing is a detectable state, not a silent empty prompt",
    () => {
      const facts = assignFactIds([
        makeFact({
          kind: "project",
          subject: "p",
          source: "projects table",
          values: { name: "p" },
        }),
      ]);
      const render = (f: typeof facts) => renderFacts(f);
      // Overhead alone busts the budget: no amount of shedding helps.
      const fitted = fitFactsToBudget(facts, render, 40_000, 100);
      assert.equal(fitted.length, 0, "the fit is honestly empty");
      // The loop turns exactly this into a thrown error rather than a prompt with
      // an empty Records block — see loop.ts. Sending it is what produced a
      // truthful "Not in your data." about records that existed.
      assert.ok(
        facts.length > 0 && fitted.length === 0,
        "this is the condition the loop must refuse to send",
      );
    },
  );
}

overheadChecks()
  .then(() => console.log(`✓ loki prompt budget: ${passed} checks passed`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
