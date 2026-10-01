/**
 * /pricing must not promise what the product does not do.
 *
 * Three lines in src/config/plans.ts were false by 2026-10-01:
 *   - "Local-first execution on your laptop or your own always-on box" — the
 *     always-on box is Loki's shared cloud builder, for eligible accounts only;
 *   - "Cross-model verification" — the cross-model judge was removed on
 *     2026-09-25 (src/lib/orchestration/dod-gate.ts);
 *   - OpenClaw in the agent list — a system gateway (switchable: false), not an
 *     agent anyone picks — while Antigravity, which people do pick, was missing.
 * And Pro carried a "Recommended" badge on a tier with no price and no
 * difference but the project ceiling.
 *
 * Run: npx tsx scripts/test/plans-copy-truth.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRICING_PLANS, PRICING_INCLUDED, PRICING_BILLING_NOTE } from "@/config/plans";
import { AGENT_IDS } from "@/lib/agent-registry";
import { AGENT_LABELS } from "@/lib/agent-labels";

const source = readFileSync(new URL("../../src/config/plans.ts", import.meta.url), "utf8");
// Comments may NAME the retired lines (that is how the next reader learns
// why they are gone); only the strings that reach the page are checked.
const shipped = [
  ...PRICING_INCLUDED,
  PRICING_BILLING_NOTE,
  ...PRICING_PLANS.flatMap((p) => [p.name, p.tagline, p.cta, ...p.highlights]),
].join("\n");

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("plans-copy-truth:");

for (const banned of [
  /local-first/i,
  /cross-model verification/i,
  /openclaw/i,
  /your own (always-on )?box/i,
]) {
  check(`no shipped pricing copy matches ${banned}`, () => {
    assert.ok(!banned.test(shipped), `found ${banned} in /pricing copy`);
  });
}

check("plans.ts code (outside comments) never reintroduces them", () => {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  for (const banned of [/Local-first/i, /Cross-model verification/i, /OpenClaw/i]) {
    assert.ok(!banned.test(code), `plans.ts code contains ${banned}`);
  }
});

check("the agent list names every agent a user can pick", () => {
  const line = PRICING_INCLUDED.find((l) => /Claude/.test(l)) ?? "";
  for (const id of AGENT_IDS) {
    const label = AGENT_LABELS[id];
    assert.ok(line.includes(label), `missing ${label} in: ${line}`);
  }
  assert.ok(!/Gemini/.test(line), "the agent is called Antigravity, not Gemini");
});

check("no paid tier is drawn louder while prices are unannounced", () => {
  const loud = PRICING_PLANS.filter((p) => p.featured && p.priceMonthly !== 0);
  assert.deepEqual(
    loud.map((p) => p.name),
    [],
    "a tier nobody can buy cannot be the recommended one",
  );
});

check("while unpriced, the note says Loki is free", () => {
  if (PRICING_PLANS.every((p) => p.priceMonthly === null || p.priceMonthly === 0)) {
    assert.match(PRICING_BILLING_NOTE, /free/i);
  }
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
