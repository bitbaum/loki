/**
 * Regression net for worktree-per-agent isolation (worktree-workspace.ts).
 *
 * Locks the four behaviors the feature exists for:
 *   1. A fresh dispatch gets its own worktree + branch; re-launch re-attaches.
 *   2. THE INCIDENT (2026-07-17): `git add -A` + commit in the primary checkout
 *      can never swallow a worktree agent's files — and vice versa.
 *   3. Cleanup never destroys work: uncommitted or unshared commits → kept;
 *      only provably-shared/empty worktrees are removed.
 *   4. Any failure degrades to the primary dir (a launch is never broken by
 *      the isolation feature).
 *
 * DB-independent; uses real `git` against throwaway repos in a tmpdir.
 * Run: npx tsx scripts/test/worktree-workspace.ts
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

// SAFETY: when git runs hooks (husky pre-push), it exports GIT_DIR — absolute
// when pushing from a linked worktree. Our git child processes inherit it, and
// an absolute GIT_DIR overrides `git -C <sandbox>`, silently redirecting every
// "throwaway repo" operation at the REAL repository (stray test@test "init"
// commits on real branches, real worktrees pruned). Strip all repo-targeting
// git env before any git subprocess runs so the sandbox stays a sandbox.
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

// Point the module's worktree root into the sandbox BEFORE importing it
// (module-level const reads the env at import time → dynamic import below).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "fc-wt-test-"));
process.env.LOKI_WORKTREES_ROOT = path.join(SANDBOX, "worktrees");

// Loaded inside main() so the env override above lands first (CJS harness —
// no top-level await; a static import would hoist above the env write).
type WorktreeModule = typeof import("@/lib/agent-execution/worktree-workspace");

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

/** A throwaway "primary checkout" with one commit and a node_modules dir. */
function makePrimary(name: string): string {
  const dir = path.join(SANDBOX, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "core.hooksPath", "/dev/null"]);
  git(dir, ["config", "user.email", "test@test"]);
  git(dir, ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "app.ts"), "export const v = 1\n");
  fs.mkdirSync(path.join(dir, "node_modules", "dep"), { recursive: true });
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

const TAB = "TestProj";

async function main(): Promise<void> {
  const {
    ensureWorktreeWorkspace,
    removeWorktreeIfClean,
    pruneWorktrees,
    worktreeBranch,
    worktreePath,
    worktreePromptNote,
    isProjectWorktreeDir,
  }: WorktreeModule = await import("@/lib/agent-execution/worktree-workspace");

  // ── 1. Creation, idempotency, fallback ─────────────────────────────────────

  const primary = makePrimary("primary");

  check("creates an isolated worktree on branch fc/<runId> from HEAD", () => {
    const wt = ensureWorktreeWorkspace(TAB, primary, "run-1");
    assert(wt !== primary, "should not fall back to primary");
    assert(wt === worktreePath(TAB, "run-1"), `unexpected path: ${wt}`);
    assert(git(wt, ["branch", "--show-current"]) === worktreeBranch("run-1"), "wrong branch");
    assert(fs.existsSync(path.join(wt, "app.ts")), "checkout missing tracked file");
  });

  check("re-launch of the same run re-attaches to the existing worktree", () => {
    const again = ensureWorktreeWorkspace(TAB, primary, "run-1");
    assert(again === worktreePath(TAB, "run-1"), "should reuse, not fail or recreate");
  });

  check("links node_modules from the primary so the agent can build immediately", () => {
    const wt = worktreePath(TAB, "run-1");
    const link = path.join(wt, "node_modules");
    assert(fs.lstatSync(link).isSymbolicLink(), "node_modules should be a symlink");
    assert(fs.existsSync(path.join(link, "dep")), "symlink should resolve to primary's deps");
  });

  check("non-git primary dir degrades gracefully to the primary (launch never breaks)", () => {
    const plain = path.join(SANDBOX, "not-a-repo");
    fs.mkdirSync(plain, { recursive: true });
    assert(ensureWorktreeWorkspace(TAB, plain, "run-x") === plain, "should fall back");
  });

  check("missing runId / dir degrades gracefully", () => {
    assert(ensureWorktreeWorkspace(TAB, primary, "") === primary, "empty runId → primary");
    const gone = path.join(SANDBOX, "gone");
    assert(ensureWorktreeWorkspace(TAB, gone, "run-y") === gone, "missing dir → unchanged");
  });

  // ── 2. THE INCIDENT — mutual isolation under `git add -A` ──────────────────

  check("`git add -A` + commit in the PRIMARY cannot swallow the worktree agent's files", () => {
    const wt = worktreePath(TAB, "run-1");
    // Agent writes in its worktree (uncommitted).
    fs.writeFileSync(path.join(wt, "agent-work.ts"), "export const agent = true\n");
    // Autopilot in the primary does the exact incident sequence.
    fs.writeFileSync(path.join(primary, "autopilot.ts"), "export const auto = true\n");
    git(primary, ["add", "-A"]);
    git(primary, ["commit", "-q", "-m", "autopilot sweep"]);
    const swallowed = git(primary, ["show", "--stat", "--name-only", "HEAD"]);
    assert(!swallowed.includes("agent-work.ts"), "primary commit swallowed the agent's file");
    // And the agent's file is still there, still uncommitted, in ITS tree only.
    assert(fs.existsSync(path.join(wt, "agent-work.ts")), "agent file lost");
    assert(
      git(wt, ["status", "--porcelain"]).includes("agent-work.ts"),
      "agent file not in its own status",
    );
    assert(!fs.existsSync(path.join(primary, "agent-work.ts")), "agent file leaked into primary");
  });

  check("primary HEAD stays on main — the worktree commit lands on the run branch only", () => {
    const wt = worktreePath(TAB, "run-1");
    git(wt, ["add", "-A"]);
    git(wt, ["commit", "-q", "-m", "agent commit"]);
    assert(git(primary, ["branch", "--show-current"]) === "main", "primary HEAD moved off main");
    const mainFiles = git(primary, ["ls-tree", "--name-only", "main"]);
    assert(!mainFiles.includes("agent-work.ts"), "agent commit reached main without a merge");
  });

  // ── 3. Cleanup never destroys work ─────────────────────────────────────────

  check("worktree with commits unmerged anywhere is KEPT (unshared work)", () => {
    assert(
      removeWorktreeIfClean(TAB, primary, "run-1") === "kept-dirty",
      "should keep unshared commits",
    );
    assert(fs.existsSync(worktreePath(TAB, "run-1")), "worktree deleted despite unshared work");
  });

  check("worktree with uncommitted changes is KEPT", () => {
    const wt = ensureWorktreeWorkspace(TAB, primary, "run-2");
    fs.writeFileSync(path.join(wt, "wip.ts"), "// wip\n");
    assert(
      removeWorktreeIfClean(TAB, primary, "run-2") === "kept-dirty",
      "should keep uncommitted work",
    );
  });

  check("clean worktree (no new commits) is removed, branch deleted", () => {
    ensureWorktreeWorkspace(TAB, primary, "run-3");
    assert(
      removeWorktreeIfClean(TAB, primary, "run-3") === "removed",
      "clean tree should be removed",
    );
    assert(!fs.existsSync(worktreePath(TAB, "run-3")), "worktree dir still present");
    const branches = git(primary, ["branch", "--list", worktreeBranch("run-3")]);
    assert(branches === "", "run branch should be deleted");
  });

  check("worktree whose commits were merged into main is removed (work is shared)", () => {
    // Merge run-1's branch into main, then cleanup may remove it.
    git(primary, ["merge", "-q", "--no-ff", "-m", "land agent work", worktreeBranch("run-1")]);
    assert(
      removeWorktreeIfClean(TAB, primary, "run-1") === "removed",
      "merged work should allow removal",
    );
  });

  check("pruneWorktrees sweeps clean ones, keeps dirty ones, reports count", () => {
    ensureWorktreeWorkspace(TAB, primary, "run-4"); // clean
    // run-2 is still dirty from above
    const removed = pruneWorktrees(TAB, primary);
    assert(removed === 1, `expected 1 removed, got ${removed}`);
    assert(fs.existsSync(worktreePath(TAB, "run-2")), "dirty worktree must survive prune");
    assert(!fs.existsSync(worktreePath(TAB, "run-4")), "clean worktree should be pruned");
  });

  check("removeWorktreeIfClean on a nonexistent worktree reports absent", () => {
    assert(removeWorktreeIfClean(TAB, primary, "never-existed") === "absent", "should be absent");
  });

  // ── 4. The prompt note ─────────────────────────────────────────────────────

  check("worktreePromptNote names the branch and the land-on-main path", () => {
    const note = worktreePromptNote("run-9");
    assert(note.includes(worktreeBranch("run-9")), "note must name the branch");
    assert(note.includes("git push origin HEAD:main"), "note must say how to land on main");
    assert(note.includes("pull --rebase"), "note must include the rebase-first step");
  });

  // ── 5. Whose agent is it? ──────────────────────────────────────────────────
  // 2026-10-02: an agent in ~/.loki/worktrees/<project>-2ba3ac62/<runId> read as
  // "no agent running" everywhere, because only the primary checkout counted.

  const root = path.join(SANDBOX, "worktrees");
  check("an agent in the project's own dispatch worktree is the project's", () => {
    assert(isProjectWorktreeDir(path.join(root, "testproj", "run-1"), TAB), "own tab folder");
    assert(isProjectWorktreeDir(path.join(root, "testproj", "run-1", "src"), TAB), "subdirectory");
  });
  check("an agent in a derived run-tab worktree (<project>~<runId8>) is the project's", () => {
    assert(
      isProjectWorktreeDir(path.join(root, "testproj-2ba3ac62", "2ba3ac62-0df4-4acc"), TAB),
      "derived run-tab folder",
    );
  });
  check("a different project whose name starts the same is NOT this project's", () => {
    assert(!isProjectWorktreeDir(path.join(root, "testproj-cli", "run-1"), TAB), "prefix sibling");
    assert(!isProjectWorktreeDir(path.join(root, "testproj-2ba3ac6", "x"), TAB), "7 hex chars");
    assert(!isProjectWorktreeDir(path.join(SANDBOX, "elsewhere", "testproj"), TAB), "outside root");
    assert(!isProjectWorktreeDir(root, TAB), "the root itself");
  });

  // ── Done ───────────────────────────────────────────────────────────────────

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  console.log(`\n${passed}/${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(1);
});
