/**
 * Where a dispatched run starts on the builder that claimed it.
 *
 * Production, 2026-11-12: a message to orangecat while a run was open got a
 * parallel lane, tab `orangecat~ef607eb7`, on the cloud builder. The project's
 * stored directory is the laptop's, `/home/g/dev/orangecat`. The runner looked
 * for the box checkout under the TAB name, found no such project, and handed
 * the laptop path to the sandbox: "Sandbox cwd does not exist:
 * /home/g/dev/orangecat". The run died before the prompt arrived.
 *
 * These run the real pieces against a throwaway dev root: the box checkout
 * step (box-workspace.ts) and the worktree step (worktree-workspace.ts), in the
 * order dispatchLaunchDir fixes.
 *
 * Run: npx tsx scripts/test/dispatch-launch-dir.ts
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// SAFETY (the same guard as worktree-workspace.ts): a hook run from a linked
// worktree exports an absolute GIT_DIR, which overrides `git -C <sandbox>`.
// Without this, a pre-push from a second worktree pointed every "throwaway"
// command below at the real repository: a test@test "init" commit on the
// branch being pushed, `core.bare = true`, a test identity and a hooks path of
// /dev/null in the real config (2026-11-12). scripts/test-unit.ts clears the
// same variables for every test; this keeps a direct run safe too.
for (const k of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
]) {
  delete process.env[k];
}

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "loki-dispatch-dir-"));
const DEV_ROOT = path.join(SANDBOX, "dev");
// Read at module load by the pieces under test, so set before they are imported.
process.env.HOME = SANDBOX;
process.env.LOKI_BOX_DEV_ROOT = DEV_ROOT;
process.env.LOKI_WORKTREES_ROOT = path.join(SANDBOX, "worktrees");

/** The path the project was registered with, on a machine that is not this one. */
const LAPTOP_DIR = "/home/g/dev/orangecat";
const RUN = "ef607eb7-0000-4000-8000-000000000000";

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
function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}
function makeCheckout(name: string): string {
  const dir = path.join(DEV_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "core.hooksPath", "/dev/null"]);
  git(dir, ["config", "user.email", "test@test"]);
  git(dir, ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "app.ts"), "export const v = 1\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

async function main() {
  assert(!fs.existsSync(LAPTOP_DIR), `${LAPTOP_DIR} exists here; this test needs it absent`);
  const { ensureBoxWorkspace } = await import("@/lib/agent-execution/box-workspace");
  const { ensureWorktreeWorkspace } = await import("@/lib/agent-execution/worktree-workspace");
  const { dispatchLaunchDir } = await import("../../desktop/src/main/lane-workspace");

  const seenProjects: string[] = [];
  /** What the cloud builder does: its own checkout, by project name. */
  const boxDeps = (worktreeEveryRun = false) => ({
    baseDir: (project: string, requested: string) => {
      seenProjects.push(project);
      return ensureBoxWorkspace(project, requested, null);
    },
    worktree: ensureWorktreeWorkspace,
    worktreeEveryRun,
  });

  const checkout = makeCheckout("orangecat");

  await check("a plain dispatch runs in the builder's checkout, not the laptop path", async () => {
    const got = await dispatchLaunchDir("orangecat", LAPTOP_DIR, RUN, boxDeps());
    assert(got.kind === "ready", `refused: ${got.kind === "refused" ? got.error : ""}`);
    if (got.kind !== "ready") return;
    assert(got.dir === checkout, `ran in ${got.dir}`);
    assert(!got.isolated, "a plain run without the flag has no worktree");
  });

  await check(
    "a parallel lane resolves the PROJECT's checkout, then its own worktree",
    async () => {
      seenProjects.length = 0;
      const got = await dispatchLaunchDir("orangecat~ef607eb7", LAPTOP_DIR, RUN, boxDeps());
      assert(got.kind === "ready", `refused: ${got.kind === "refused" ? got.error : ""}`);
      if (got.kind !== "ready") return;
      assert(seenProjects.join() === "orangecat", `looked up ${seenProjects.join()}`);
      assert(got.primaryDir === checkout, `primary was ${got.primaryDir}`);
      assert(got.isolated && got.dir !== checkout, "the lane shares the checkout");
      assert(fs.existsSync(path.join(got.dir, "app.ts")), `${got.dir} is not a worktree of it`);
      assert(!got.dir.startsWith("/home/g/"), `the laptop path reached the launch: ${got.dir}`);
      assert(fs.existsSync(got.dir), "the launch directory does not exist");
    },
  );

  await check("no laptop path survives for any tab shape", async () => {
    for (const tab of ["orangecat", "orangecat~ef607eb7", "OrangeCat~0a1b2c3d"]) {
      for (const flag of [false, true]) {
        const got = await dispatchLaunchDir(tab, LAPTOP_DIR, RUN, boxDeps(flag));
        const dir = got.kind === "ready" ? got.dir : "";
        assert(dir !== LAPTOP_DIR, `${tab} (flag ${flag}) would launch in ${LAPTOP_DIR}`);
      }
    }
  });

  await check("a project the builder cannot find or clone is refused with the reason", async () => {
    const got = await dispatchLaunchDir("ghost~ef607eb7", "/home/g/dev/ghost", RUN, boxDeps());
    assert(got.kind === "refused", "launched without a checkout");
    if (got.kind !== "refused") return;
    assert(/no checkout of "ghost" on this builder/.test(got.error), got.error);
    assert(/nothing was launched/.test(got.error), got.error);
  });

  await check(
    "a lane that cannot get a worktree is refused, never run in the shared checkout",
    async () => {
      const got = await dispatchLaunchDir("orangecat~ef607eb7", LAPTOP_DIR, RUN, {
        baseDir: async () => checkout,
        worktree: (_tab, primary) => primary, // ensureWorktreeWorkspace's failure value
        worktreeEveryRun: false,
      });
      assert(got.kind === "refused", "two agents would share one checkout");
    },
  );

  await check("a laptop runner keeps the directory it was given", async () => {
    const got = await dispatchLaunchDir("orangecat", checkout, RUN, {
      baseDir: async (_p, requested) => requested,
      worktree: ensureWorktreeWorkspace,
      worktreeEveryRun: false,
    });
    assert(got.kind === "ready" && got.dir === checkout, "identity on the laptop");
  });

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  if (failures) {
    console.log(`\ndispatch-launch-dir: ${failures} failed`);
    process.exit(1);
  }
  console.log("\ndispatch-launch-dir: all passed");
}

void main();
