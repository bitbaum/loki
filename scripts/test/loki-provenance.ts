/**
 * Answer provenance — what the operator is told about where an answer came from.
 * Run: npx tsx scripts/test/loki-provenance.ts
 *
 * The load-bearing case is the WARNING. The grounding harness has always
 * computed a per-turn verdict and the core has always returned it; the /loki
 * route dropped it when persisting and the floating assistant never read it.
 * So a turn whose unsupported claims survived the repair pass rendered exactly
 * like a clean one — which is the precise failure the harness exists to
 * prevent ("being wrong looked exactly like being right"), reintroduced at the
 * last inch of the pipeline. A persist that silently drops the verdict must
 * fail here.
 *
 * Pure: no database, no model, no DOM.
 */
import assert from "node:assert/strict";
import {
  describeProvenance,
  pickProvenance,
  readProvenance,
  splitModelId,
  PROVENANCE_KEYS,
  type LokiProvenance,
} from "../../src/lib/loki/provenance";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const CLEAN: LokiProvenance = {
  via: "tool-loop",
  model: "loki/groq/openai/gpt-oss-120b",
  durationMs: 2340,
  toolsUsed: ["list_runs"],
  work: [
    { kind: "note", text: "Two runs failed overnight — reading them." },
    { kind: "tool", name: "list_runs", phase: "end", facts: 7 },
  ],
  rounds: 2,
  retrieved: [
    { source: "feedback", count: 5 },
    { source: "runs", count: 7 },
    { source: "projects", count: 22 },
    { source: "economy", count: 0 },
  ],
  grounding: { checked: true, ok: true, factCount: 34, unsupported: [] },
};

const FLAGGED: LokiProvenance = {
  ...CLEAN,
  grounding: {
    checked: true,
    ok: false,
    factCount: 34,
    unsupported: [{ kind: "novel-proper-noun", text: "Impact Hub Zurich" }],
  },
};

// ── 1. A round trip through opaque persisted meta ───────────────────────────
{
  check("provenance survives persist → reload", () => {
    const persisted = pickProvenance({ ok: true, text: "…", ...CLEAN });
    const back = readProvenance(persisted);
    assert.ok(back, "provenance must survive the JSON round trip");
    assert.equal(back.via, "tool-loop");
    assert.equal(back.rounds, 2);
    assert.deepEqual(back.toolsUsed, ["list_runs"]);
    assert.equal(back.grounding.factCount, 34);
  });

  check("pickProvenance copies every declared key and nothing else", () => {
    const picked = pickProvenance({ ok: true, text: "…", sources: [{ id: "F1" }], ...CLEAN });
    assert.deepEqual(
      Object.keys(picked).sort(),
      [...PROVENANCE_KEYS].sort(),
      "a route must persist exactly the provenance keys — no more, and crucially no fewer",
    );
  });

  check("meta from before provenance existed reads as none, never as a crash", () => {
    assert.equal(readProvenance(null), null);
    assert.equal(readProvenance({}), null);
    assert.equal(readProvenance({ model: "groq/x", projectKey: "loki" }), null);
  });

  check("a foreign or partial grounding object degrades to unchecked, not to clean", () => {
    const back = readProvenance({ via: "tool-loop", model: "x", grounding: "nonsense" });
    assert.ok(back);
    assert.equal(back.grounding.checked, false, "unparseable grounding is UNCHECKED");
  });
}

// ── 2. THE WARNING — a flagged answer must look different ───────────────────
{
  check("a clean answer shows provenance and no warning", () => {
    const line = describeProvenance(CLEAN);
    assert.equal(line.warn, false);
    assert.deepEqual(line.unsupported, []);
  });

  check("a FLAGGED answer warns, and names what was unsupported", () => {
    const line = describeProvenance(FLAGGED);
    assert.equal(line.warn, true, "an answer that failed verification must be visibly flagged");
    assert.deepEqual(line.unsupported, ["Impact Hub Zurich"]);
  });

  check(
    "dropping the grounding key on persist loses the warning — so it must not be dropped",
    () => {
      // The mutation this gate exists for: persist everything EXCEPT grounding,
      // exactly as the /loki route did before 2026-09-11, and confirm the flag
      // is gone. If this ever stops being true the gate has stopped testing
      // anything.
      const lossy = { ...pickProvenance({ ...FLAGGED }) };
      delete (lossy as Record<string, unknown>).grounding;
      const back = readProvenance(lossy);
      assert.ok(back);
      assert.equal(
        describeProvenance(back).warn,
        false,
        "without the grounding key a flagged answer reads as clean — which is why PROVENANCE_KEYS is the contract",
      );
    },
  );

  check("no records to check against reads as UNCHECKED, not as verified", () => {
    const line = describeProvenance({
      ...CLEAN,
      retrieved: [],
      grounding: { checked: false, ok: true, factCount: 0, unsupported: [] },
    });
    assert.equal(line.warn, false, "unchecked is not a violation");
    assert.ok(
      line.segments.some((s) => /unchecked/i.test(s)),
      `the operator must be told the turn was unverifiable: ${line.segments.join(" · ")}`,
    );
  });
}

// ── 3. The line itself ──────────────────────────────────────────────────────
{
  check("the model id is split into model and vendor", () => {
    assert.deepEqual(splitModelId("loki/groq/openai/gpt-oss-120b"), {
      model: "openai/gpt-oss-120b",
      vendor: "groq",
    });
    assert.deepEqual(splitModelId("openclaw/main"), { model: "main", vendor: "openclaw" });
    assert.deepEqual(splitModelId("bare"), { model: "bare", vendor: null });
  });

  check("the line says what was READ, skipping sources that returned nothing", () => {
    const line = describeProvenance(CLEAN).segments.join(" · ");
    assert.match(line, /read .*feedback 5/, `expected the feedback count: ${line}`);
    assert.match(line, /runs 7/, `expected the run count: ${line}`);
    assert.doesNotMatch(line, /economy/, `a source that returned nothing is noise: ${line}`);
  });

  check("the line names the tools that ran and how long it took", () => {
    const line = describeProvenance(CLEAN).segments.join(" · ");
    assert.match(line, /used list_runs/, line);
    assert.match(line, /2\.3s/, line);
  });

  check("a degraded path says so — a fallback answer must not pass as the real one", () => {
    const gateway = describeProvenance({ ...CLEAN, via: "gateway" }).segments.join(" · ");
    assert.match(gateway, /fallback/i, gateway);
    const groq = describeProvenance({ ...CLEAN, via: "groq-fallback" }).segments.join(" · ");
    assert.match(groq, /degraded/i, groq);
    const primary = describeProvenance(CLEAN).segments.join(" · ");
    assert.doesNotMatch(
      primary,
      /fallback|degraded/i,
      `the primary path is unlabelled: ${primary}`,
    );
  });
}

console.log(`✓ loki provenance: ${passed} checks passed`);

// ── The work trail round-trips through persistence ───────────────────────────
// A reopened thread must show what the turn did, exactly as it showed live.
// Only finished steps are records; a `start` left over from a dead stream is
// dropped, and a note with nothing in it is not a note.
check("work survives pick → persist → read, finished steps only", () => {
  const persisted = pickProvenance({
    ...CLEAN,
    work: [
      ...CLEAN.work,
      { kind: "tool", name: "search_people", phase: "start" },
      { kind: "note", text: "   " },
      { kind: "tool", name: "list_goals", phase: "fail" },
      { bogus: true },
    ],
  } as unknown as Record<string, unknown>);
  assert.ok(PROVENANCE_KEYS.includes("work"), "work is a provenance key");
  const back = readProvenance(persisted);
  assert.ok(back);
  assert.deepEqual(back!.work, [
    { kind: "note", text: "Two runs failed overnight — reading them." },
    { kind: "tool", name: "list_runs", phase: "end", facts: 7 },
    { kind: "tool", name: "list_goals", phase: "fail" },
  ]);
});
check("a message from before work existed reads as an answer that showed no work", () => {
  const legacy = pickProvenance({ ...CLEAN, work: undefined } as unknown as Record<
    string,
    unknown
  >);
  assert.deepEqual(readProvenance(legacy)!.work, []);
});
console.log(`loki-provenance: ${passed} checks`);
