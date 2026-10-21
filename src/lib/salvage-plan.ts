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

/**
 * Pure: the agent finished its job — everything is committed, its branch is
 * not the default one, and an open PR's head is exactly what is checked out.
 * Returns that PR's URL (the run closes Done with it), else null.
 * Substrata c7d57dc0, 2026-10-22: the agent opened #190 and then sat at its
 * prompt for 20+ minutes with the run still "Working".
 */
export function shippedPr(s: {
  dirty: boolean;
  branch: string | null;
  defaultBranch: string;
  headSha: string;
  pr: { url: string; state: string; headRefOid: string } | null;
}): string | null {
  if (s.dirty || !s.branch || s.branch === s.defaultBranch || !s.pr) return null;
  if (s.pr.state !== "OPEN" || !s.headSha || s.pr.headRefOid !== s.headSha) return null;
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(s.pr.url) ? s.pr.url : null;
}
