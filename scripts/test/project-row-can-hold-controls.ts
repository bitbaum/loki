/**
 * The project row must be able to contain controls.
 *
 * The row WAS a single `<Link>` wrapping everything, with
 * `aria-label="Open {name}"`. HTML forbids interactive content inside an
 * anchor, so the row had ZERO interactive children by construction: every
 * number and every flag on it led to the same generic destination, and the
 * health chip could only ever be a dead `<span>` explained by a hover `title` —
 * invisible on touch, and a bare "7/10" to a screen reader.
 *
 * The capability was never missing. `HealthScoreBar` has always had an
 * `interactive` mode: a real button, `aria-expanded`, a panel naming each
 * missing point with an inline edit, and a draft-from-the-brief action. The
 * list simply could not use it.
 *
 * So this is a STRUCTURAL invariant, not a style preference: the row is a
 * container, the project NAME is the link, and its `::after` stretches over the
 * row so the whole thing stays one click target. Collapsing it back to a
 * wrapping anchor would silently re-delete every control inside it — the page
 * would still render, nothing would fail to compile, and the disclosure would
 * just quietly stop existing again.
 *
 * Run: npx tsx scripts/test/project-row-can-hold-controls.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROW = join(process.cwd(), "src/components/projects/ProjectRow.tsx");
const CSS = join(process.cwd(), "src/app/globals.css");
const rowSrc = readFileSync(ROW, "utf8");
// Strip CSS comments for the same reason as the TSX ones below: the comment
// above these rules names `.ui-projects-row-actions`, so an unstripped scan
// finds the prose before the rule and asserts against explanatory text.
const css = readFileSync(CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// The comments here quote the very things under test; scanning them would let
// the file pass on its own prose.
const code = rowSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

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

console.log("project-row-can-hold-controls:");

check("THE INVARIANT: the row is not itself a link", () => {
  // The opening element of the returned tree. A <Link> here forbids every
  // control inside it.
  const ret = code.slice(code.indexOf("return ("));
  const firstTag = ret.slice(0, ret.indexOf(">") + 1);
  assert(
    !/^\s*\(\s*<Link/.test(ret.slice(0, 40)),
    `the row is a <Link> again — nothing inside it may be interactive: ${firstTag.replace(/\s+/g, " ").slice(0, 80)}`,
  );
});

check("the project name carries the stretched link", () => {
  assert(
    code.includes("ui-projects-row-link"),
    "no stretched-link class — either the row is an anchor again, or the row is no longer clickable as a whole",
  );
  const at = code.indexOf("ui-projects-row-link");
  const around = code.slice(Math.max(0, at - 300), at + 200);
  assert(around.includes("<Link"), "ui-projects-row-link is not on a Link");
  assert(around.includes("project.id"), "the stretched link does not point at the project");
});

check("and that class actually stretches, in globals.css", () => {
  // A class the CSS does not define would leave the row un-clickable except on
  // the name itself — a silent, large usability regression.
  const at = css.indexOf(".ui-projects-row-link::after");
  assert(at !== -1, "ui-projects-row-link::after is not defined in globals.css");
  const block = css.slice(at, at + 200);
  assert(
    block.includes("absolute") && block.includes("inset-0"),
    `::after does not cover the row: ${block.slice(0, 120)}`,
  );
});

check("THE PAYOFF: the health chip is the interactive one", () => {
  const at = code.indexOf("<HealthScoreBar");
  assert(at !== -1, "HealthScoreBar is gone from the row");
  const el = code.slice(at, code.indexOf("/>", at) + 2);
  assert(
    /\binteractive\b/.test(el),
    "the row still renders the dead read-only chip — a bare number with a hover title",
  );
  assert(el.includes("projectId"), "no projectId — the disclosure would be read-only");
});

check("controls sit above the stretched overlay — by position, NOT z-index", () => {
  // Without this the ::after covers the chip and the click opens the project
  // instead of expanding the breakdown — which looks like the feature is broken
  // rather than absent.
  //
  // CORRECTED: this originally demanded `z-[1]` here, and that was wrong. A
  // z-index makes every row its own STACKING CONTEXT, which traps the health
  // panel inside its row — the panel asks for z-40 and every row below still
  // paints over it. Shipped that way in #832 and it made the disclosure
  // unreadable on production.
  //
  // `relative` alone is sufficient and correct: this and the link's ::after
  // are both positioned with z-index auto, so they paint in DOM order and the
  // actions come second. The test now pins the INTENT (positioned, no
  // stacking context) instead of one broken implementation of it.
  assert(
    code.includes("ui-projects-row-actions"),
    "the controls column is not lifted above the stretched link",
  );
  const at = css.indexOf(".ui-projects-row-actions");
  assert(at !== -1, "ui-projects-row-actions is not defined in globals.css");
  const block = css.slice(at, css.indexOf("}", at));
  assert(
    block.includes("relative"),
    `actions are not positioned, so the stretched link swallows their clicks: ${block.slice(0, 120)}`,
  );
  assert(
    !/z-\[|z-\d/.test(block),
    `a z-index is back — it traps the health panel inside the row: ${block.replace(/\s+/g, " ")}`,
  );
});

check("the whole row is still one link, not two competing ones", () => {
  // Two anchors to the same project reads as two stops to a screen reader and
  // makes the old aria-label wrapper trick worth re-adding. There should be
  // exactly one Link to /projects/{id} in the row.
  const links = code.match(/<Link\b/g) ?? [];
  assert(links.length === 1, `expected exactly one <Link> in the row, found ${links.length}`);
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
