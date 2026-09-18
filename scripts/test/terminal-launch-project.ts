/**
 * Which project the Terminal's empty state offers to start an agent in.
 *
 * Found by using the page: the terminal was scoped to `loki` — the breadcrumb
 * said so and the tab strip linked to `/control?focus=loki` — while the launch
 * form two inches below offered "Bitbaum", the first project in the list.
 * Clicking the one obvious button would have started Claude in the wrong
 * repository, and nothing on screen said so.
 *
 * Run: npx tsx scripts/test/terminal-launch-project.ts
 */
import { preferredLaunchProject } from "@/components/terminal/TerminalLaunch";

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

const P = (name: string) => ({ name, dir: `/home/g/dev/${name}`, agentPref: null });
const PROJECTS = [P("Bitbaum"), P("loki"), P("orangecat")];

console.log("terminal-launch-project:");

check("the project in scope wins over the first in the list", () => {
  assert(
    preferredLaunchProject(PROJECTS, "loki") === "loki",
    `expected loki, got ${preferredLaunchProject(PROJECTS, "loki")}`,
  );
});

check("with no project in scope it falls back to the first", () => {
  // Not a guess — with nothing in scope there is no better answer, and an
  // empty select would disable the only button on the screen.
  assert(preferredLaunchProject(PROJECTS, null) === "Bitbaum", "null should fall back");
  assert(preferredLaunchProject(PROJECTS, undefined) === "Bitbaum", "undefined should fall back");
  assert(preferredLaunchProject(PROJECTS, "") === "Bitbaum", "empty string should fall back");
});

check("a scoped project that cannot be launched does not get pre-selected", () => {
  // `launchable` is already filtered to projects with a linked directory.
  // Offering one that is not in it would draw a button that fails every time.
  assert(preferredLaunchProject(PROJECTS, "solon") === "Bitbaum", "unlaunchable must not win");
});

check("no projects at all yields no selection rather than throwing", () => {
  assert(preferredLaunchProject([], "loki") === "", "empty list");
});

check("the rule is stable across the render where scope arrives", () => {
  // THE BUG, pinned. The scope is null on the first render (it comes from a
  // store the server cannot read) and real a tick later. A value captured once
  // at mount would stay "Bitbaum" forever; a derived one corrects itself.
  const first = preferredLaunchProject(PROJECTS, null);
  const afterHydration = preferredLaunchProject(PROJECTS, "loki");
  assert(first === "Bitbaum", "pre-hydration falls back");
  assert(afterHydration === "loki", "post-hydration follows the scope");
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
