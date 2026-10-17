/**
 * Several sessions of one project, started by hand from the terminal's "+".
 *
 * Asked for from a phone (2026-10-17): "I usually have multiple tabs open, so I
 * can do multiple things simultaneously." Starting a project that already had
 * a session launched into the SAME tab, which replaces the running agent; and a
 * hand-started lane tab ran in the project's one checkout, so two agents would
 * have shared an index — the 2026-07-17 `git add -A` swallow. These pin both.
 *
 * Run: npx tsx scripts/test/terminal-session-lanes.ts
 */
import {
  MAX_PARALLEL_LANES_PER_PROJECT,
  nextSessionTab,
  runLaneOfTab,
  sessionsOfProject,
} from "@/lib/run-tab";
import { laneNumber } from "@/components/terminal/terminal-strip-tabs";
import { laneLaunchDir, type LaneDirDeps } from "../../desktop/src/main/lane-workspace";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
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

const RUN = "3f2a9c1e-0000-4000-8000-000000000000";

async function main() {
  await check("a project with nothing open starts as its own tab", () => {
    assert(
      nextSessionTab(["orangecat"], "substrata", RUN) === "substrata",
      "expected the plain tab",
    );
  });

  await check("a project that already has a session gets a lane, never the same tab", () => {
    const tab = nextSessionTab(["substrata"], "substrata", RUN);
    assert(tab !== null && tab !== "substrata", `got ${tab}`);
    assert(runLaneOfTab(tab!)?.project === "substrata", `${tab} is not a lane of substrata`);
  });

  await check("a free project tab is used before another lane", () => {
    assert(
      nextSessionTab(["substrata~1a2b3c4d"], "substrata", RUN) === "substrata",
      "the base tab was free",
    );
  });

  await check("a lane id that is taken is not reused", () => {
    const first = nextSessionTab(["substrata"], "substrata", RUN)!;
    const second = nextSessionTab(["substrata", first], "substrata", RUN);
    assert(second !== null && second !== first, `reused ${first}`);
  });

  await check("the limit is the base tab plus the shared lane limit", () => {
    const open = ["substrata"];
    for (let i = 0; i < MAX_PARALLEL_LANES_PER_PROJECT; i++) {
      const next = nextSessionTab(open, "substrata", `${i}abcdef0-1111-2222-3333-444444444444`);
      assert(next !== null, `lane ${i + 1} should be allowed`);
      open.push(next!);
    }
    assert(nextSessionTab(open, "substrata", RUN) === null, "one more than the limit was allowed");
  });

  await check("sessions of a project ignore case and other projects", () => {
    const got = sessionsOfProject(
      ["Substrata", "substrata~1a2b3c4d", "substrata-cli"],
      "substrata",
    );
    assert(got.length === 2, `got ${got.join(", ")}`);
  });

  await check("extra sessions read as project 2, 3 in the runner's order", () => {
    const tabs = ["substrata", "substrata~aaaa1111", "orangecat", "substrata~bbbb2222"];
    assert(laneNumber(tabs, "substrata~aaaa1111") === 2, "first lane should be 2");
    assert(laneNumber(tabs, "substrata~bbbb2222") === 3, "second lane should be 3");
  });

  const deps = (worktreeResult: (primary: string) => string): LaneDirDeps => ({
    baseDir: async (project) => `/srv/${project}`,
    worktree: (_tab, primary) => worktreeResult(primary),
  });

  await check("a plain tab launches where it was asked to", async () => {
    const got = await laneLaunchDir(
      "substrata",
      "/home/g/dev/substrata",
      deps(() => "/never"),
    );
    assert(got.kind === "plain" && got.dir === "/home/g/dev/substrata", JSON.stringify(got));
  });

  await check("a lane runs in its own worktree of the project's checkout", async () => {
    const got = await laneLaunchDir(
      "substrata~1a2b3c4d",
      "/x",
      deps((p) => `${p}/wt`),
    );
    assert(
      got.kind === "lane" && got.dir === "/srv/substrata/wt" && got.primaryDir === "/srv/substrata",
      JSON.stringify(got),
    );
  });

  await check("a lane that cannot get a worktree is refused, not squeezed in", async () => {
    const got = await laneLaunchDir(
      "substrata~1a2b3c4d",
      "/x",
      deps((p) => p),
    );
    assert(got.kind === "refused" && /nothing was launched/.test(got.error), JSON.stringify(got));
  });

  if (failures) {
    console.log(`\n${failures} failing`);
    process.exit(1);
  }
  console.log("\nall passing");
}

void main();
