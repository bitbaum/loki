/**
 * Worktree-per-agent — run each dispatched agent in its own git worktree so it
 * can never collide with the primary checkout (or another agent) on a shared
 * index/HEAD.
 *
 * Why (incident, 2026-07-17): an autopilot mid-run executed `git add -A` in the
 * primary checkout while a second agent had a branch checked out there — the
 * autopilot's commit swallowed the other agent's files AND landed on the wrong
 * branch, because two agents shared one worktree/index. Isolation at the
 * filesystem level is the only fix that holds under `add -A`.
 *
 * Design mirrors box-workspace.ts (the existing dir-swap precedent): a pure
 * "resolve the effective dir" helper called from the launch path, gated by an
 * env flag, degrading gracefully to the primary dir on any failure — the flag
 * can only add isolation, never break a launch.
 *
 *   primary checkout        <dir>                    (human's / never dispatched-into)
 *   worktree per dispatch   ~/.loki/worktrees/<tab>/<runId>
 *   branch per dispatch     fc/<runId>  (from the primary's current HEAD)
 *
 * Untracked essentials (node_modules, .env*) are symlinked from the primary so
 * the agent can build/test immediately — a bare worktree without deps would
 * push every agent through a full install.
 *
 * Cleanup: `removeWorktreeIfClean` deletes a worktree only when it has no
 * uncommitted changes AND no unpushed commits — an agent's unfinished work is
 * never destroyed. `pruneWorktrees` sweeps stale clean ones (crashed runs).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

/** Master switch, default OFF for safe rollout (the same flag pattern that
 *  carried owned PTYs from opt-in to the only substrate; worktrees start
 *  opt-in). Set LOKI_WORKTREE_DISPATCH=true to enable. */
export const WORKTREE_DISPATCH_ENABLED = process.env.LOKI_WORKTREE_DISPATCH === "true";

const WORKTREES_ROOT =
  process.env.LOKI_WORKTREES_ROOT || path.join(os.homedir(), ".loki", "worktrees");

/** Untracked artifacts linked from the primary checkout into a fresh worktree.
 *  Symlinks, not copies: deps stay warm and env stays single-sourced. */
const LINKED_ARTIFACTS = ["node_modules", ".env", ".env.local", ".env.selfhost.local"];

function sanitize(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "x"
  );
}

function git(dir: string, args: string[], timeoutMs = 60_000): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function worktreeBranch(runId: string): string {
  return `fc/${sanitize(runId)}`;
}

export function worktreePath(tab: string, runId: string): string {
  return path.join(WORKTREES_ROOT, sanitize(tab), sanitize(runId));
}

/**
 * True when `cwd` is inside one of THIS project's dispatch worktrees: the
 * project tab's own folder, or a derived run-tab's ("<project>~<runId8>",
 * sanitized to "<project>-<runId8>").
 *
 * Why it exists (2026-10-02, xhiva-art-refresh): the agent ran in
 * ~/.loki/worktrees/<project>-2ba3ac62/<runId> while "is an agent running?"
 * only matched the primary checkout, so a working agent read as absent
 * everywhere — the build card said "no agent has picked it up, starting again
 * is safe", Terminal said "session ended", Ask left it out, and the run never
 * closed. The suffix is exactly eight hex characters, so a different project
 * whose name merely starts the same ("loki" vs "loki-cli") never matches.
 */
export function isProjectWorktreeDir(
  cwd: string,
  tab: string,
  root: string = WORKTREES_ROOT,
): boolean {
  const rel = path.relative(root, cwd);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const first = rel.split(path.sep)[0];
  const base = sanitize(tab);
  return (
    first === base ||
    (first.startsWith(`${base}-`) && /^[0-9a-f]{8}$/.test(first.slice(base.length + 1)))
  );
}

/** True when the dir is inside a git repository (worktrees only make sense there). */
function isGitRepo(dir: string): boolean {
  try {
    return git(dir, ["rev-parse", "--is-inside-work-tree"]) === "true";
  } catch {
    return false;
  }
}

/** Link untracked essentials (deps, env) from the primary checkout so the agent
 *  can run verify/build immediately. Best-effort per artifact — a missing
 *  node_modules just means the agent installs. */
function linkArtifacts(primaryDir: string, wtDir: string): void {
  for (const name of LINKED_ARTIFACTS) {
    const src = path.join(primaryDir, name);
    const dst = path.join(wtDir, name);
    try {
      if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
      fs.symlinkSync(src, dst);
    } catch {
      /* best-effort — agent falls back to installing / missing env surfaces in-run */
    }
  }
}

/**
 * Resolve the effective working dir for a dispatch: an isolated worktree at
 * ~/.loki/worktrees/<tab>/<runId> on branch fc/<runId>, created from the
 * primary checkout's current HEAD.
 *
 * Graceful degradation: any failure (not a git repo, git missing, disk full)
 * logs and returns the primary dir — the dispatch proceeds exactly as before
 * the feature existed. Idempotent per (tab, runId): re-launching a run
 * re-attaches to its existing worktree.
 */
export function ensureWorktreeWorkspace(tab: string, primaryDir: string, runId: string): string {
  try {
    if (!runId || !primaryDir || !fs.existsSync(primaryDir)) return primaryDir;
    if (!isGitRepo(primaryDir)) return primaryDir;

    const wtDir = worktreePath(tab, runId);
    if (fs.existsSync(path.join(wtDir, ".git"))) {
      // Re-attach (runner restart mid-run, retried launch).
      linkArtifacts(primaryDir, wtDir);
      return wtDir;
    }

    fs.mkdirSync(path.dirname(wtDir), { recursive: true });
    const branch = worktreeBranch(runId);
    // -B: a crashed earlier attempt may have left the branch without a
    // worktree; reuse it rather than failing the launch.
    git(primaryDir, ["worktree", "add", "-B", branch, wtDir, "HEAD"], 120_000);
    linkArtifacts(primaryDir, wtDir);
    console.log(`[worktree] ${tab}: dispatch runs in ${wtDir} (branch ${branch})`);
    return wtDir;
  } catch (e) {
    console.warn(
      `[worktree] ${tab}: falling back to primary checkout: ${e instanceof Error ? e.message : String(e)}`,
    );
    return primaryDir;
  }
}

/** True when the worktree has no uncommitted changes and no commits that exist
 *  only locally (unpushed and unmerged into any other ref). */
function isWorktreeClean(wtDir: string): boolean {
  try {
    // Disregard the artifact symlinks WE created (node_modules, .env*): they
    // are recreatable, not work — and in repos that don't gitignore them they
    // show as untracked, which would block cleanup forever.
    const status = git(wtDir, ["status", "--porcelain"])
      .split("\n")
      .filter((line) => {
        if (!line) return false;
        const p = line.slice(3).replace(/\/$/, "");
        if (!line.startsWith("??") || !LINKED_ARTIFACTS.includes(p)) return true;
        try {
          return !fs.lstatSync(path.join(wtDir, p)).isSymbolicLink();
        } catch {
          return true;
        }
      });
    if (status.length > 0) return false;
    // Commits reachable from HEAD but from no OTHER ref = work that would be
    // lost on removal. NB: `--not --all` is a trap here — --all includes the
    // worktree's own branch, so the count would always be 0. Exclude only the
    // own branch; remotes are refs too, so pushed work counts as shared.
    const ownBranch = git(wtDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const otherRefs = git(wtDir, ["for-each-ref", "--format=%(refname)"])
      .split("\n")
      .filter((r) => r && r !== `refs/heads/${ownBranch}`);
    if (otherRefs.length === 0) return false; // nothing to be shared WITH → keep
    const onlyHere = git(wtDir, ["rev-list", "HEAD", "--not", ...otherRefs, "--count"]);
    return onlyHere === "0";
  } catch {
    return false; // can't prove it's safe → treat as dirty
  }
}

/**
 * Remove a run's worktree if (and only if) it holds no unsaved/unshared work.
 * Returns what happened so the caller can log/surface it. The branch is
 * deleted only when fully merged elsewhere (`-d`, not `-D`).
 */
export function removeWorktreeIfClean(
  tab: string,
  primaryDir: string,
  runId: string,
): "removed" | "kept-dirty" | "absent" {
  const wtDir = worktreePath(tab, runId);
  if (!fs.existsSync(wtDir)) return "absent";
  if (!isWorktreeClean(wtDir)) {
    console.log(`[worktree] ${tab}/${runId}: kept (uncommitted or unshared work)`);
    return "kept-dirty";
  }
  try {
    git(primaryDir, ["worktree", "remove", wtDir], 120_000);
  } catch {
    // Symlinked artifacts or stray untracked files can block a plain remove
    // even when git-clean; the tree is verified clean, so force is safe.
    try {
      git(primaryDir, ["worktree", "remove", "--force", wtDir], 120_000);
    } catch (e) {
      console.warn(
        `[worktree] ${tab}/${runId}: remove failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return "kept-dirty";
    }
  }
  try {
    git(primaryDir, ["branch", "-d", worktreeBranch(runId)]);
  } catch {
    /* branch has unmerged commits (pushed elsewhere) or already gone — fine */
  }
  return "removed";
}

/** Sweep all of a tab's worktrees, removing every clean one. Crash-recovery:
 *  runs that never reached their close hook leave worktrees behind; this keeps
 *  the pool bounded without ever touching dirty trees. Returns removed count. */
export function pruneWorktrees(tab: string, primaryDir: string): number {
  const tabRoot = path.join(WORKTREES_ROOT, sanitize(tab));
  let removed = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(tabRoot);
  } catch {
    return 0;
  }
  for (const runId of entries) {
    if (removeWorktreeIfClean(tab, primaryDir, runId) === "removed") removed++;
  }
  // Clear git's bookkeeping for any worktree dirs deleted out-of-band.
  try {
    git(primaryDir, ["worktree", "prune"]);
  } catch {
    /* primary gone or not a repo — nothing to prune */
  }
  return removed;
}

/**
 * One-line instruction appended to a dispatch prompt when the agent runs in a
 * worktree — how to land work without fighting the isolation. Kept here so the
 * prompt text and the mechanism can't drift apart.
 */
export function worktreePromptNote(runId: string): string {
  return (
    `NOTE: you are in an isolated git worktree on branch ${worktreeBranch(runId)} ` +
    `(worktree-per-agent isolation). Work and commit here as normal. To land your ` +
    `work on main when done: git pull --rebase origin main && git push origin HEAD:main. ` +
    `Do not switch branches or cd to the primary checkout.`
  );
}
