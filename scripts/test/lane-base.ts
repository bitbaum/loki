/**
 * A lane starts from the remote default branch, not from the shared session's
 * branch.
 *
 * The cloud builder keeps one checkout per project and puts each new run of the
 * project's own session on `loki/run-<id8>`. A lane (a parallel run, a fresh
 * one-off, the terminal's "+") is a worktree of that checkout, and it was cut
 * from HEAD: it began with the shared session's unmerged commits, and its pull
 * request carried them.
 *
 * Real git, in a throwaway directory: a bare "GitHub", a clone, a run branch
 * with a commit of its own.
 *
 * Run: npx tsx scripts/test/lane-base.ts
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "loki-lane-base-"));
process.env.LOKI_WORKTREES_ROOT = path.join(SANDBOX, "worktrees");
// The builder's dev root and home (claude-prep writes trust settings there).
process.env.LOKI_BOX_DEV_ROOT = path.join(SANDBOX, "dev");
process.env.HOME = SANDBOX;

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
function configure(dir: string) {
  git(dir, ["config", "core.hooksPath", "/dev/null"]);
  git(dir, ["config", "user.email", "test@test"]);
  git(dir, ["config", "user.name", "test"]);
}

/** "GitHub" with one commit on main, and the builder's clone of it. */
function project(name: string): { clone: string; mainSha: string; remote: string; seed: string } {
  const seed = path.join(SANDBOX, `${name}-seed`);
  fs.mkdirSync(seed, { recursive: true });
  git(seed, ["init", "-q", "-b", "main"]);
  configure(seed);
  fs.writeFileSync(path.join(seed, "app.ts"), "export const v = 1\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-q", "-m", "main: v1"]);
  const remote = path.join(SANDBOX, `${name}.git`);
  execFileSync("git", ["clone", "-q", "--bare", seed, remote]);
  const clone = path.join(SANDBOX, "dev", name);
  execFileSync("git", ["clone", "-q", remote, clone]);
  configure(clone);
  return { clone, mainSha: git(clone, ["rev-parse", "origin/main"]), remote, seed };
}

async function main() {
  const { ensureWorktreeWorkspace, laneBaseRef, primaryCheckoutOf } =
    await import("@/lib/agent-execution/worktree-workspace");
  const { ensureBoxWorkspace } = await import("@/lib/agent-execution/box-workspace");

  // The shared session's run: its own branch, with a commit not on main.
  const { clone, mainSha } = project("orangecat");
  git(clone, ["checkout", "-q", "-B", "loki/run-9e3658d9", "origin/main"]);
  fs.writeFileSync(path.join(clone, "app.ts"), "export const v = 2 // the shared session's edit\n");
  git(clone, ["commit", "-qam", "shared session: tests edited"]);
  const sharedSha = git(clone, ["rev-parse", "HEAD"]);

  await check("the remote default branch is found", () => {
    assert(laneBaseRef(clone) === "origin/main", laneBaseRef(clone));
  });

  await check("a fresh lane starts at main, without the shared session's commit", () => {
    const wt = ensureWorktreeWorkspace("orangecat~ef607eb7", clone, "ef607eb7-run");
    assert(wt !== clone, "no worktree was made");
    assert(git(wt, ["rev-parse", "HEAD"]) === mainSha, "the lane does not start at main");
    assert(!git(wt, ["log", "--format=%s"]).includes("shared session"), "it carries the commit");
    assert(fs.readFileSync(path.join(wt, "app.ts"), "utf8").includes("v = 1"), "it has the edit");
  });

  await check("the shared session's checkout is left on its own branch", () => {
    assert(git(clone, ["rev-parse", "--abbrev-ref", "HEAD"]) === "loki/run-9e3658d9", "moved");
    assert(git(clone, ["rev-parse", "HEAD"]) === sharedSha, "its commit moved");
  });

  await check("a worktree for the project's own tab still starts where the checkout is", () => {
    const wt = ensureWorktreeWorkspace("orangecat", clone, "plain-run");
    assert(git(wt, ["rev-parse", "HEAD"]) === sharedSha, "a plain run's worktree moved off HEAD");
  });

  await check("a lane of a checkout with no remote starts at HEAD, as before", () => {
    const local = path.join(SANDBOX, "dev", "solo");
    fs.mkdirSync(local, { recursive: true });
    git(local, ["init", "-q", "-b", "main"]);
    configure(local);
    fs.writeFileSync(path.join(local, "a.txt"), "a\n");
    git(local, ["add", "-A"]);
    git(local, ["commit", "-qm", "only"]);
    assert(laneBaseRef(local) === "HEAD", laneBaseRef(local));
    const wt = ensureWorktreeWorkspace("solo~0a1b2c3d", local, "solo-run");
    assert(
      wt !== local && git(wt, ["rev-parse", "HEAD"]) === git(local, ["rev-parse", "HEAD"]),
      wt,
    );
  });

  await check("an old clone without origin/HEAD still finds origin/main", () => {
    const { clone: old } = project("oldclone");
    git(old, ["remote", "set-head", "origin", "-d"]);
    assert(laneBaseRef(old) === "origin/main", laneBaseRef(old));
  });

  await check(
    "a lane's checkout step only fetches: the shared session's files stay put",
    async () => {
      // The shared session's run branch tracks origin/main (checkout -B from
      // it), has not committed yet, and is mid-edit. main moves on.
      const p = project("busy");
      git(p.clone, ["checkout", "-q", "-B", "loki/run-aaaa1111", "origin/main"]);
      fs.writeFileSync(path.join(p.clone, "wip.txt"), "the live agent's unsaved work\n");
      fs.writeFileSync(path.join(p.seed, "app.ts"), "export const v = 3 // merged meanwhile\n");
      git(p.seed, ["commit", "-qam", "main: v3"]);
      git(p.seed, ["push", "-q", p.remote, "main"]);
      const before = git(p.clone, ["rev-parse", "HEAD"]);

      const dir = await ensureBoxWorkspace("busy", "/home/g/dev/busy", null, { pull: false });
      assert(dir === p.clone, `resolved ${dir}`);
      assert(git(p.clone, ["rev-parse", "HEAD"]) === before, "the shared run branch was moved");
      assert(
        fs.readFileSync(path.join(p.clone, "app.ts"), "utf8").includes("v = 1"),
        "files moved",
      );
      assert(
        git(p.clone, ["rev-parse", "origin/main"]) !== before,
        "origin/main was not fetched, so the lane would start from an old main",
      );
      const wt = ensureWorktreeWorkspace("busy~bbbb2222", p.clone, "bbbb2222-run");
      assert(
        fs.readFileSync(path.join(wt, "app.ts"), "utf8").includes("v = 3"),
        "lane is not on new main",
      );

      // The base tab's own launch still brings the checkout up to date.
      await ensureBoxWorkspace("busy", "/home/g/dev/busy", null);
      assert(git(p.clone, ["rev-parse", "HEAD"]) !== before, "a plain launch no longer pulls");
    },
  );

  await check("a lane reopened after a restart is traced back to its checkout", () => {
    const wt = ensureWorktreeWorkspace("orangecat~ef607eb7", clone, "ef607eb7-run");
    assert(primaryCheckoutOf(wt) === fs.realpathSync(clone), `got ${primaryCheckoutOf(wt)}`);
    assert(primaryCheckoutOf(clone) === null, "a plain checkout is not a worktree");
    assert(primaryCheckoutOf(path.join(SANDBOX, "nowhere")) === null, "a missing folder");
  });

  await check(
    "the builder asks for the fetch-only step for lanes, and the real folder of a live lane",
    () => {
      const src = fs.readFileSync(path.join(process.cwd(), "desktop/src/main/poller.ts"), "utf8");
      assert(
        /builderCheckoutDir\(project, requested, \{ forLane: true \}\)/.test(src),
        "the terminal's + still pulls the shared checkout",
      );
      assert(
        /builderCheckoutDir\(project, requested, \{ forLane: isDerivedRunTab\(tab\) \}\)/.test(src),
        "a lane dispatch still pulls the shared checkout",
      );
      assert(/pull: !opts\.forLane/.test(src), "the lane flag does not reach the checkout step");
      assert(
        /worktreeByTab\.get\(tab\)\?\.launchDir \?\? ptyDirForTab\(tab\) \?\? dispatchDir/.test(
          src,
        ),
        "a live lane after a restart is looked for in the dispatch's folder",
      );
    },
  );

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  if (failures) {
    console.log(`\nlane-base: ${failures} failed`);
    process.exit(1);
  }
  console.log("\nlane-base: all passed");
}

void main();
