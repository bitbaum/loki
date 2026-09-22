/**
 * A health signal has ONE name.
 *
 * Seen on production 2026-09-22, evig's health panel, three headings stacked:
 *
 *     ✕ Security risk    Email verification bypass: anyone can register…
 *     ✕ Broken           Marketplace, Repairers, IT-Hilfe (API returns HTML)…
 *     ✕ Deploy issue     CMS backend (Express port 3001) not deployed…
 *
 * "Broken" is not a thing. It read as an unfinished string next to two real
 * labels — and four inches away, the same signal on the same page was writing
 * itself out as "4 broken features".
 *
 * The cause was two fields for one concept. Every signal carried BOTH a
 * `label` and a `cardLabel`, and they had drifted in wording AND in casing:
 *
 *     label            cardLabel
 *     "Security risk"  "Security Risk"
 *     "Broken"         "Broken Features"
 *     "Deploy issue"   "Deployment Issue"
 *
 * Nothing distinguished them — no surface needed a different word, they were
 * simply written twice and maintained once. So the badge said one thing and
 * the raise-a-flag sheet said another, about the same flag, and the one that
 * got left short is the one the operator saw at the top of the panel.
 *
 * THE RULE: one name per signal, sentence case, and no second name field. A
 * surface that wants it lowercase calls `.toLowerCase()`; it does not get its
 * own copy to drift from.
 *
 * Run: npx tsx scripts/test/one-name-per-signal.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
// HEALTH_SIGNAL_BASE is the pure data. HEALTH_SIGNAL_CONFIG is the same list
// with Lucide icons attached, and lives in a .tsx — importing it here would
// drag React into a plain node script for no gain.
import { HEALTH_SIGNAL_BASE } from "../../src/components/projects/project-detail-types";

const ROOT = process.cwd();

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

console.log("one-name-per-signal:");

check("THE BUG: no signal is named with a bare adjective", () => {
  // "Broken" is the specific one that shipped, but the rule is the shape: a
  // heading that names a signal has to name a THING.
  for (const cfg of HEALTH_SIGNAL_BASE) {
    assert(
      cfg.label.trim().split(/\s+/).length >= 2,
      `"${cfg.label}" is one word — it reads as an unfinished string next to "Security risk" and "Deploy issue"`,
    );
  }
});

check("RULE: there is no second name field to drift from", () => {
  const offenders = walk(join(ROOT, "src"))
    .map((p) => ({ rel: relative(ROOT, p), src: readFileSync(p, "utf8") }))
    .filter((f) => /\bcardLabel\b/.test(f.src));
  assert(
    offenders.length === 0,
    `a second name for a signal is back in: ${offenders.map((o) => o.rel).join(", ")} — one label, and call .toLowerCase() at the surface that wants it`,
  );
});

check("the names are sentence case, not Title Case", () => {
  // "Security Risk" beside "Deploy issue" is the drift showing through even
  // when both fields say roughly the same words.
  for (const cfg of HEALTH_SIGNAL_BASE) {
    const rest = cfg.label.trim().split(/\s+/).slice(1);
    const capitalised = rest.filter((w) => /^[A-Z]/.test(w));
    assert(
      capitalised.length === 0,
      `"${cfg.label}" is Title Case — sentence case is the house style for these headings (offending: ${capitalised.join(", ")})`,
    );
  }
});

check("every signal is still named at all", () => {
  assert(HEALTH_SIGNAL_BASE.length > 0, "there are no signals — re-point this gate");
  for (const cfg of HEALTH_SIGNAL_BASE) {
    assert(Boolean(cfg.label?.trim()), `signal "${cfg.kind}" has no label`);
    assert(Boolean(cfg.clearRule?.trim()), `signal "${cfg.kind}" states no rule for passing`);
  }
});

check("no two signals share a name", () => {
  const seen = new Map<string, string>();
  for (const cfg of HEALTH_SIGNAL_BASE) {
    const key = cfg.label.toLowerCase();
    const prev = seen.get(key);
    assert(!prev, `"${cfg.label}" names both "${prev}" and "${cfg.kind}"`);
    seen.set(key, cfg.kind);
  }
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
