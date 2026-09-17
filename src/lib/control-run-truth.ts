import { isRunProgressFresh } from "@/lib/run-progress";

type RunActivitySnapshot = {
  finishedAt: Date | string | null;
  payload: Record<string, unknown> | null;
};

/**
 * A run is live only when the runner verified that the prompt reached a
 * generating agent and continued to report fresh PTY output. Control uses
 * this same evidence as Feedback/Watch so a worktree process that is absent
 * from the project process scan cannot disappear from the fleet count.
 */
export function isVerifiedRunActive(
  run: RunActivitySnapshot | null | undefined,
  now = Date.now(),
): boolean {
  if (!run || run.finishedAt || run.payload?.injectVerified !== true) return false;
  const lastProgressAt = run.payload.lastProgressAt;
  return typeof lastProgressAt === "string" && isRunProgressFresh(lastProgressAt, now);
}
