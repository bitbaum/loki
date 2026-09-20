/**
 * Dead `ui-*` rules in globals.css — a ratchet that may only go down.
 *
 * WHY A SECOND CHECKER
 * --------------------
 * check-loki-classes.mjs holds `ui-loki-*` to zero in BOTH directions, which is
 * the right bar and is reachable because that surface was rebuilt in one go.
 * The other 1,000-odd `ui-*` rules have never been checked at all, and they
 * carry 35 rules that nothing references.
 *
 * That matters more here than in most codebases, because this repo's Layer 3
 * contract says every recurring visual pattern gets a named class. A reader
 * looking for "how do we draw a metric card" finds `.ui-control-metric-card`,
 * `.ui-control-metric-value`, `.ui-control-metric-label` and
 * `.ui-control-metrics-grid` in globals.css and reasonably concludes that is
 * the house style. Nothing has used them for months. Dead CSS in a system
 * whose whole premise is "the class IS the decision" does not read as dead —
 * it reads as load-bearing, and the next person builds to match it.
 *
 * WHY A RATCHET AND NOT A HARD ZERO
 * ---------------------------------
 * 35 rules is real work to remove safely, and removal is not a mechanical
 * delete: some of these are one commit away from being used again, and a few
 * belong to surfaces that are mid-rebuild. A hard failure today would be
 * turned off tomorrow. The ratchet is the same shape the repo already uses for
 * dead exports (scripts/test/dead-exports-ratchet.ts, "baseline 3"): the number
 * cannot grow, and every deletion lowers it for good.
 *
 * DYNAMIC CLASS NAMES
 * -------------------
 * `ui-dot-${kind}` appears in source as the literal `ui-dot-`. A token ending
 * in a hyphen is treated as a prefix and marks every matching rule used —
 * without that, this check reports ~77 false orphans and gets ignored, which
 * is the failure mode of every lint nobody trusts.
 *
 * Run: node scripts/check-ui-classes.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Lower this when you delete a rule. Never raise it.
 *
 * If a change needs a NEW class, that class is used by definition — it cannot
 * push this number up. A rise means something stopped being referenced and
 * its rule was left behind.
 */
const ORPHAN_BASELINE = 35;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(full)) out.push(full);
  }
  return out;
}

const css = readFileSync("src/app/globals.css", "utf8");

// Only a selector at the start of a line defines a rule. A mention inside a
// comment or a compound selector does not.
const defined = new Set([...css.matchAll(/^\s*\.(ui-[a-z0-9-]+)/gm)].map((m) => m[1]));

// Every token that could reference one: JSX/TS source, plus `@apply` inside
// globals.css itself (a rule composed from another rule is a real use).
const tokens = new Set([...css.matchAll(/@apply[^;]*?(ui-[a-z0-9-]+)/g)].map((m) => m[1]));
for (const file of walk("src")) {
  for (const m of readFileSync(file, "utf8").matchAll(/ui-[a-z0-9-]+/g)) tokens.add(m[0]);
}

const exact = new Set();
const prefixes = [];
for (const t of tokens) {
  if (t.endsWith("-")) prefixes.push(t);
  else exact.add(t);
}

const isUsed = (cls) => exact.has(cls) || prefixes.some((p) => cls.startsWith(p));
const orphaned = [...defined].filter((c) => !isUsed(c)).sort();

if (orphaned.length > ORPHAN_BASELINE) {
  console.error(
    `✗ dead ui-* rules rose to ${orphaned.length} (baseline ${ORPHAN_BASELINE}).\n` +
      `  Something stopped referencing a class and its rule was left in globals.css.\n` +
      `  Delete the rule with the code that used it — or, if it is genuinely still\n` +
      `  wanted, say where. Current list:\n` +
      orphaned.map((c) => `    ${c}`).join("\n"),
  );
  process.exit(1);
}

if (orphaned.length < ORPHAN_BASELINE) {
  console.error(
    `✗ dead ui-* rules fell to ${orphaned.length} — lower ORPHAN_BASELINE in\n` +
      `  scripts/check-ui-classes.mjs to ${orphaned.length} so the ground you just\n` +
      `  gained cannot be given back.`,
  );
  process.exit(1);
}

console.log(
  `✓ ${defined.size} ui-* rules: ${orphaned.length} unused (at baseline, ` +
    `${prefixes.length} dynamic prefixes honoured)`,
);
