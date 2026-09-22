/**
 * A phone must be able to see the thing the list is ordered by.
 *
 * /projects sorts by recency and now says so in its subtitle ("flagged first,
 * then most recently active", #830). Its row put health, "active … ago" and the
 * open-feedback count in a right-hand column marked `sm:flex` — so on a phone
 * none of them rendered. The page asked you to trust a sequence whose evidence
 * it had hidden on the viewport where it matters most.
 *
 * `Needs path` had the same problem for a worse reason: it means Loki cannot
 * dispatch an agent for that project AT ALL — the most actionable badge on the
 * row — and it was `hidden sm:inline-flex`.
 *
 * WHAT THIS TEST IS AND IS NOT. It reads the source, so it proves the classes
 * are right, not that the pixels are. Real rendering at 320/390/768/1440 is
 * `pnpm run audit:responsive`, which needs a running server and so cannot live
 * in the env-independent unit suite. This gate exists because the regression it
 * catches is a one-word edit (`sm:hidden` → `hidden`) that no type or lint
 * error would ever flag.
 *
 * Run: npx tsx scripts/test/mobile-shows-what-the-list-sorts-by.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROW = join(process.cwd(), "src/components/projects/ProjectRow.tsx");
const src = readFileSync(ROW, "utf8");
// The breakpoint classes live in globals.css, per design principle 7 (every
// value comes from a token / a named class). An earlier version of this test
// looked for `sm:hidden` INSIDE the component and therefore failed the moment
// the row was rebuilt correctly — it pinned one implementation of the rule
// rather than the rule. Read both files and assert the INTENT: the phone shows
// the facts the list is sorted by, wherever the class is declared.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

// Comments explain the rule and quote the very class names under test, so
// scanning them would let a file pass on its own prose. Strip them first.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

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

/** The JSX element (opening tag → closing tag) that carries a class. */
function blockWithClass(needle: string): string | null {
  const at = code.indexOf(needle);
  if (at === -1) return null;
  const open = code.lastIndexOf("<", at);
  return code.slice(open, at + 600);
}

console.log("mobile-shows-what-the-list-sorts-by:");

check("THE BUG: a mobile-only meta line exists", () => {
  const inComponent = code.includes("sm:hidden");
  const namedClass = /\.ui-projects-row-meta\s*\{[^}]*sm:hidden/.test(css);
  assert(
    inComponent || namedClass,
    "nothing is mobile-only in the project row — the phone viewport has no meta line at all",
  );
  if (namedClass) {
    assert(
      code.includes("ui-projects-row-meta"),
      "the mobile meta class exists in CSS but the row does not render it",
    );
  }
});

check("that line carries the recency the page is sorted by", () => {
  const block = blockWithClass("ui-projects-row-meta") ?? blockWithClass("sm:hidden");
  assert(block !== null, "could not locate the mobile meta line");
  assert(
    /recency|lastRun/.test(block!),
    "the mobile line does not render the run time — the sort key is invisible on a phone",
  );
});

check("and the health score", () => {
  const block = (blockWithClass("ui-projects-row-meta") ?? blockWithClass("sm:hidden"))!;
  assert(block.includes("health.score"), "the mobile line does not render the health score");
});

check("and the open-feedback count", () => {
  const block = (blockWithClass("ui-projects-row-meta") ?? blockWithClass("sm:hidden"))!;
  assert(block.includes("feedbackOpen"), "the mobile line drops the open-feedback count");
});

check("THE OTHER ONE: `Needs path` is no longer desktop-only", () => {
  // It means no agent can be dispatched for this project. Hiding the most
  // actionable badge on the narrowest viewport is backwards.
  const badge = blockWithClass("loopReadiness.label");
  assert(badge !== null, "could not find the loop-readiness badge");
  const openingTag = badge!.slice(0, badge!.indexOf(">") + 1);
  assert(
    !/\bhidden\b/.test(openingTag),
    `the loop-readiness badge is still hidden on mobile: ${openingTag.replace(/\s+/g, " ")}`,
  );
});

check("the desktop rail is still there", () => {
  // Mobile gets its own line; that must not have replaced the wider layout.
  const railIsResponsive = /\.ui-projects-rail\s*\{[^}]*sm:flex/.test(css);
  assert(
    railIsResponsive || code.includes("sm:flex"),
    "the sm+ rail was removed rather than complemented",
  );
  assert(code.includes("HealthScoreBar"), "the health control was dropped from the desktop rail");
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
