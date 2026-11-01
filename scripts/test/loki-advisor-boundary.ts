/**
 * Loki says which side of the line it stands on, in BOTH of its system prompts.
 *
 * The capability preface (LOKI_CAPABILITIES) listed what Loki cannot do, but
 * only on fallback turns, and the role statement itself never said what kind
 * of thing Loki is. Agreed in the 2026-10-31 dogfooding round: one sentence —
 * advisory surface, not executor; no Calendar, no email, no direct change to
 * the fleet; proposals for the approval queue only — in the tool loop's
 * prompt and in the fallback's, from one constant so they cannot drift.
 * Run: npx tsx scripts/test/loki-advisor-boundary.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ADVISOR_BOUNDARY } from "../../src/lib/loki/advisor-boundary";
import { systemPrompt } from "../../src/lib/agent/loop";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

for (const phrase of [
  "advisory surface, not the executor",
  "Google Calendar",
  "email",
  "approval queue",
]) {
  assert.ok(ADVISOR_BOUNDARY.includes(phrase), `the boundary names: ${phrase}`);
}

// The tool loop's prompt, on an answering round and on a tool round alike.
assert.ok(systemPrompt({}, true).includes(ADVISOR_BOUNDARY), "tool round carries the boundary");
assert.ok(systemPrompt({}, false).includes(ADVISOR_BOUNDARY), "answer round carries the boundary");

// The fallback's prompt uses the same constant, not a retyped copy.
const core = readFileSync(join(ROOT, "src/lib/loki-core.ts"), "utf8");
const roleStatement = core.slice(
  core.indexOf("const LOKI_SYSTEM_PROMPT ="),
  core.indexOf("/**", core.indexOf("const LOKI_SYSTEM_PROMPT =")),
);
assert.ok(roleStatement.includes("${ADVISOR_BOUNDARY}"), "LOKI_SYSTEM_PROMPT carries the boundary");
assert.ok(
  !core.includes("advisory surface, not the executor"),
  "the sentence is not retyped in loki-core",
);

console.log("loki-advisor-boundary: ok");
