/**
 * A thing shaped like a meter has to read like one.
 *
 * The health track renders ten segments. They were emitted in CHECK ORDER, so
 * the failures landed wherever they happened to fall and a 7/10 came out as
 *
 *     ●●●●●○○●●●      (filled, filled, gap, filled)
 *
 * which is the shape of a progress bar carrying the content of a checklist
 * laid sideways. At a glance it reads as neither — it looks like a row of
 * dots with something wrong in the middle. Seen on /projects, 2026-09-22.
 *
 * Sorting earned-first costs nothing, because segment POSITION carries no
 * information to anybody: the track is `aria-hidden`, and no segment is
 * labelled, hoverable, or individually addressable. WHICH checks failed is
 * the panel's job, and the panel names every one of them in full.
 *
 * This test exists to make that trade explicit. If a segment ever becomes
 * identifiable — a tooltip per check, a click target — the sort must go, and
 * this test should fail loudly rather than let the two quietly contradict.
 *
 * Run: npx tsx scripts/test/health-bar-reads-as-a-meter.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { computeProjectHealth } from "@/lib/project-health";
import { HEALTH_SIGNAL_BASE } from "@/components/projects/project-detail-types";

const SRC = join(process.cwd(), "src/components/projects/HealthScore.tsx");
const code = readFileSync(SRC, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

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

console.log("health-bar-reads-as-a-meter:");

check("THE BUG: the track is sorted before it renders", () => {
  assert(
    /\[\s*\.\.\.checks\s*\]\s*\.sort\(/.test(code),
    "segments render in check order again — a 7/10 will show gaps in the middle of the bar",
  );
});

check("it sorts by pass, earned first", () => {
  const at = code.indexOf(".sort(");
  const expr = code.slice(at, at + 120);
  assert(/b\.pass/.test(expr) && /a\.pass/.test(expr), `not sorting on pass: ${expr.slice(0, 80)}`);
  // Number(b.pass) - Number(a.pass) puts true (1) before false (0).
  assert(
    expr.indexOf("b.pass") < expr.indexOf("a.pass"),
    "sorted failures first — the bar would fill from the wrong end",
  );
});

check("the original check order is not mutated", () => {
  // The panel lists failing checks and the fill action reads them; reordering
  // the source array in place would reorder those too.
  assert(
    code.includes("[...checks]"),
    "checks is sorted IN PLACE — the panel's own ordering is collateral damage",
  );
});

check("THE TRADE: no segment is individually addressable", () => {
  // The moment a segment gets a title, a tooltip or a click, position starts
  // carrying meaning and this sort becomes a lie.
  // The track element ONLY. A wider window runs past its closing tag into the
  // chip below, which legitimately carries a `title` — and the test then fails
  // on a neighbour rather than on the thing it is guarding.
  const at = code.indexOf("ui-health-track");
  assert(at !== -1, "the health track is gone");
  // Anchor on the map's own closing rather than on indentation: a fixed
  // character window, or a marker with whitespace baked into it, runs past the
  // track's closing tag into the chip below — which legitimately carries a
  // `title`, so the test would fail on a neighbour instead of its subject.
  const mapEnd = code.indexOf("))}", at);
  assert(mapEnd !== -1, "could not find the end of the segment map");
  const block = code.slice(at, mapEnd);
  for (const banned of ["title=", "onClick", "aria-label", "data-check"]) {
    assert(
      !block.includes(banned),
      `a segment now carries ${banned} — position means something, so the sort must go`,
    );
  }
  assert(block.includes("aria-hidden"), "the track stopped being aria-hidden");
});

check("sorting never changes the score itself", () => {
  // Paranoia, cheaply bought: the number comes from the checks, not the track.
  const health = computeProjectHealth({
    description: "A real brief that is long enough to count for something.",
    gitUrl: "https://github.com/bitbaum/x",
    dirPath: "/tmp/x",
    liveUrl: "https://x.test",
    attrs: {},
  });
  const sorted = [...health.checks].sort((a, b) => Number(b.pass) - Number(a.pass));
  assert(
    sorted.filter((c) => c.pass).length === health.checks.filter((c) => c.pass).length,
    "sorting changed how many checks pass",
  );
  assert(sorted.length === health.max, `segment count ${sorted.length} != max ${health.max}`);
});

check("THE PANEL IS NOT TRAPPED: rows do not create a stacking context", () => {
  // A z-index on .ui-projects-row-actions makes every row its own stacking
  // context, and the panel's z-40 then only ranks it against its own row —
  // so every row below paints over the open disclosure. Seen live the moment
  // the stretched link shipped: the panel opened with other rows' text
  // bleeding through it, unreadable.
  const at = css.indexOf(".ui-projects-row-actions");
  assert(at !== -1, "ui-projects-row-actions is gone");
  const block = css.slice(at, css.indexOf("}", at));
  assert(
    !/z-\[|z-\d/.test(block),
    `a z-index is back on the row actions — it traps the health panel: ${block.replace(/\s+/g, " ")}`,
  );
  assert(
    block.includes("relative"),
    "the actions must stay positioned to clear the stretched link",
  );
});

check("the panel hangs from the right, where the chip is", () => {
  // Left-anchored, a 24rem panel opened off the right edge of the screen and
  // cut its own sentences in half.
  // The SECOND .ui-health-panel rule is the sm+ override; the first is the
  // mobile sheet, which is `fixed inset-x-4` and deliberately has no left-0.
  // Searching from the first "min-width: 40rem" in the file finds neither —
  // the stylesheet has dozens of them, long before this block.
  const base = css.indexOf(".ui-health-panel");
  const at = css.indexOf(".ui-health-panel", base + 1);
  assert(at !== -1, "no sm+ rule for the health panel");
  const block = css.slice(at, css.indexOf("}", at));
  assert(block.includes("right-0"), `panel is not right-anchored: ${block.replace(/\s+/g, " ")}`);
  assert(!/\bleft-0\b/.test(block), "panel is still left-anchored and will overflow the viewport");
});

check("THE HALF-APPLIED FIX: every signal rule names its noun", () => {
  // clearLabel was written per signal precisely to stop machine-built
  // sentences losing their noun; `rule` was left deriving from `label` and
  // still read "Passes while no broken is recorded on this project."
  for (const s of HEALTH_SIGNAL_BASE) {
    assert(Boolean(s.clearRule), `${s.kind} has no clearRule`);
    assert(
      !/\bno (broken|security|deploy) is\b/.test(s.clearRule),
      `${s.kind} rule lost its noun: ${s.clearRule}`,
    );
    assert(/\.$/.test(s.clearRule), `${s.kind} rule is not a sentence: ${s.clearRule}`);
  }
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
