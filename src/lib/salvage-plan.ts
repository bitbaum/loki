/**
 * Pure: what Loki does with an agent's work when the agent's process ends
 * before it shipped. Substrata on Antigravity, 2026-10-21: the fix was staged
 * in the worktree and lost to the run when the agent died — no commit, no PR.
 * Committed or uncommitted, work the agent left behind becomes a draft PR.
 */
export type SalvageState = {
  dirty: boolean;
  branch: string | null;
  defaultBranch: string;
  /** Commits on HEAD (after any salvage commit) that the default branch lacks. */
  ahead: number;
  hasOpenPr: boolean;
};

export type SalvageStep = "commit" | "branch" | "push" | "open_pr";

export function salvagePlan(s: SalvageState): SalvageStep[] {
  const steps: SalvageStep[] = [];
  if (s.dirty) steps.push("commit");
  const ahead = s.ahead + (s.dirty ? 1 : 0);
  if (ahead === 0) return [];
  if (!s.branch || s.branch === s.defaultBranch) steps.unshift("branch");
  steps.push("push");
  if (!s.hasOpenPr) steps.push("open_pr");
  return steps;
}
