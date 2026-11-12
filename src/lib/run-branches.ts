/**
 * The branches a run worked on: the only way a pull request or a push on
 * GitHub is tied to a run. No imports on purpose (server and runner both
 * read it).
 *
 * Until 2026-11-12 "the run's pull request" was the newest pull request a
 * person opened in the repository after the run started. That is a time
 * window, not an attribution. Run 70d1a78d on loki ran `git status` and
 * nothing else; its page showed loki#1636 as its pull request and "Pushed:"
 * with that pull request's commit, because somebody had opened #1636 by hand,
 * on another branch, while the run was open. docs/foundation/RUN-STATUS-SSOT.md:
 * "A pull request that is another run's is not proof."
 *
 * A run's branches are:
 *   - the branch the cloud builder starts every new run on (`loki/run-<id8>`),
 *   - its worktree branch when it has a lane of its own (`fc/<runId>`),
 *   - every branch its runner reported the agent's checkout on while the run
 *     was live (the progress beat, payload.branches): a session that keeps an
 *     earlier branch, or an agent that names its own.
 * The default branch is never one of them, even when the agent sat on it:
 * every merge is a push to `main`, so "a push to main while the run was
 * open" says nothing about the run. Work landed straight on main is tied to
 * its run by the commit the handoff names, not by this.
 *
 * Nothing else. A run whose runner reported no branch and that used neither
 * named branch has no live repo evidence, and its page says so rather than
 * borrow a neighbour's.
 */

/** The branch a run works on: one per run, named so it is obviously Loki's. */
export function runBranchName(runId: string): string {
  return `loki/run-${runId
    .replace(/[^0-9a-zA-Z]/g, "")
    .slice(0, 8)
    .toLowerCase()}`;
}

/** Directory- and ref-safe form of a run id or tab (worktree-workspace). */
export function sanitizeRunKey(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "x"
  );
}

/** The branch of a run's own worktree. */
export function worktreeBranchName(runId: string): string {
  return `fc/${sanitizeRunKey(runId)}`;
}

/** How many reported branches a run keeps. An agent rarely uses two. */
export const RUN_BRANCHES_MAX = 8;

/** A branch name as git allows it, or null. `HEAD` is a detached checkout. */
export function cleanBranchName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/^refs\/heads\//, "");
  if (!name || name.length > 200 || name === "HEAD") return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return null;
  if (name.includes("..") || name.startsWith("/") || name.endsWith("/")) return null;
  return name;
}

/** payload.branches with one more reported branch: unique, newest last, capped. */
export function withReportedBranch(existing: unknown, reported: unknown): string[] {
  const kept = (Array.isArray(existing) ? existing : [])
    .map(cleanBranchName)
    .filter((b): b is string => b !== null);
  const branch = cleanBranchName(reported);
  const next = branch ? [...kept.filter((b) => b !== branch), branch] : kept;
  return next.slice(-RUN_BRANCHES_MAX);
}

/** Branches everybody pushes to: being on one attributes nothing. */
const SHARED_BRANCHES = new Set(["main", "master", "develop", "trunk"]);

/** Every branch that is this run's. */
export function runBranches(run: { id: string; payload?: unknown }): string[] {
  const reported = withReportedBranch(
    (run.payload as { branches?: unknown } | null | undefined)?.branches,
    null,
  ).filter((b) => !SHARED_BRANCHES.has(b));
  return [...new Set([runBranchName(run.id), worktreeBranchName(run.id), ...reported])];
}

/** Is a pull request's head branch, or a pushed ref, one of the run's own? */
export function refBelongsToRun(ref: unknown, branches: readonly string[]): boolean {
  const name = cleanBranchName(ref);
  return name !== null && branches.includes(name);
}
