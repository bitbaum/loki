/**
 * A project page leads with what is WRONG, not with what the machine is doing.
 *
 * Measured on production 2026-09-22, the evig project page, Now tab, top of
 * the viewport:
 *
 *     BUILD
 *     ● Nothing is being built right now              [ Make it happen ]
 *     Last attempt finished partially 24d ago after 16m
 *     ────────────────────────────────────────────────────────────
 *     Security risk   Email verification bypass: anyone can register
 *                     @revamp-it.ch and get Staff role with admin access
 *                     to 14 areas                                  [Fix]
 *     4 broken features   …
 *     Deploy issue        …
 *
 * The page's largest type and its only orange button went to "nothing is
 * happening". A live authentication bypass was plain grey text below it.
 *
 * This is the same fault /today had (see today-answers-the-question.ts): the
 * surface reported the MACHINE'S STATUS where the reader was asking what needs
 * them. Idle is not news; a security hole is.
 *
 * THE RULE: when a project has flags, the flags render FIRST. When it has
 * none, the build status leads — at that point "nothing is being built" really
 * is the most useful thing the tab can say. Need above status, but only when
 * there is need.
 *
 * Run: npx tsx scripts/test/project-leads-with-need.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const view = strip(
  readFileSync(join(ROOT, "src/components/projects/ProjectWorkspaceView.tsx"), "utf8"),
);
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

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

console.log("project-leads-with-need:");

check("THE BUG: flags render BEFORE the build status", () => {
  const flags = view.indexOf("{flagsBlock}");
  const build = view.indexOf("<ProjectBuildStatus");
  assert(flags !== -1, "the Now tab renders no flags block");
  assert(build !== -1, "the Now tab renders no build status — re-point this gate");
  assert(
    flags < build,
    "the build status renders above the flags — a live security hole sits under 'nothing is being built'",
  );
});

check("the flags are the FIRST thing in the tab, not merely above BUILD", () => {
  // Sliding them one slot up the stack is not the fix if an interview, a
  // kickoff or an invitation still opens the tab ahead of them.
  const body = view.slice(view.indexOf('id: "now"'));
  const flags = body.indexOf("{flagsBlock}");
  assert(flags !== -1, "flagsBlock is not rendered inside the Now tab");
  for (const later of ["<ProjectInterview", "<ProjectKickoff", "<ProjectBuildStatus"]) {
    const at = body.indexOf(later);
    if (at === -1) continue;
    assert(flags < at, `${later} opens the tab ahead of the flags`);
  }
});

check("a project with NO flags still leads with the build status", () => {
  // The rule is "need above status", not "always hide status". With nothing
  // wrong, "nothing is being built right now" is the useful headline, so the
  // block must be null rather than an empty heading.
  assert(
    /healthSignals\.length\s*>\s*0\s*\?/.test(view),
    "the flags block is not conditional on there being flags — a clean project would render an empty alarm",
  );
  assert(/:\s*null/.test(view), "the no-flags branch does not render nothing");
});

check("the block has a heading naming what it is, in words", () => {
  // Design reset (2026-10-21): a sentence-case section heading — "Needs
  // fixing" — over one row per problem, not a coloured count.
  assert(/title="Needs fixing"/.test(view), "the flags block has no heading naming what it is");
});

check("it carries no tint: the alarm is a red dot per row (principles 2 and 3)", () => {
  const at = css.indexOf(".ui-project-flag {");
  assert(at !== -1, "the flag rows have no ui-* class — style lives in globals.css");
  const block = css.slice(at, css.indexOf("}", at));
  assert(
    !/\bbg-(?!transparent)/.test(block),
    `the alarm is tinted; the dot is the only colour: ${block.replace(/\s+/g, " ")}`,
  );
  assert(/ui-dot-negative/.test(view), "a flag row carries no red dot");
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
