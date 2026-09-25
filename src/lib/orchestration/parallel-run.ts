import { promptForLane } from "@/lib/orchestration/lane-prompt";
import { deriveRunTab } from "@/lib/run-tab";
import { countOpenParallelLanes, mergeRunPayload } from "@/db/queries/orchestration-runs";

/**
 * Same-project parallel dispatch: when a project is busy, give the new run its
 * own lane instead of a place in the queue.
 *
 * Loki serialises per project because two agents in ONE checkout collide on a
 * shared index and HEAD (the `git add -A` swallow, 2026-07-17). Worktree-per-
 * agent removes that reason. A run with a DERIVED tab alias
 * (`<project>~<runId8>`) gets its own git worktree — the runner forces the
 * isolation for derived tabs regardless of its own env flag (desktop poller
 * and box runner alike), so parallel-without-isolation cannot happen — plus its
 * own session handoff file, sentinels and PTY workspace, because every one of
 * those is keyed by tab. The run row keeps the BASE projectKey, so analytics
 * and busy checks still aggregate per project, and `payload.sessionTab`
 * carries the alias for the close path.
 *
 * This used to live inline in /api/orchestration/run, so the one path that
 * could dispatch without waiting was the one a person rarely uses. Pressing
 * Implement on a feedback item — the moment somebody is standing there to
 * watch — went through inject-core and queued behind whatever the project was
 * already doing. Measured 2026-09-17: a feedback fix waited 47 minutes behind
 * a Next Best Task before an agent saw it. Both paths now share this.
 */

/** Opt-in: a worktree per run is a real cost on the builder's disk. */
export const PARALLEL_DISPATCH_ENABLED = process.env.LOKI_PARALLEL_DISPATCH === "true";

/**
 * At most this many parallel lanes per project, on top of the base lane.
 *
 * Each lane is a whole agent: a PTY, a Claude Code (or other CLI) process, a
 * worktree, and a share of ONE subscription's rate limit. Unbounded, a busy
 * project plus an eager autopilot would fan out until the builder or the
 * account throttles everything at once — which is slower than queueing. Two
 * extra lanes lets Implement start immediately beside a long autopilot run
 * without turning one busy project into a stampede; past it, the queue does
 * its old job.
 */
export const MAX_PARALLEL_LANES_PER_PROJECT = 2;

export type ParallelRunPlan = {
  /** The derived tab alias to dispatch against. */
  tab: string;
  /** The prompt, its exit contract pointed at the derived session file. */
  prompt: string;
};

/**
 * Claim a parallel lane for `runId`, or return null to keep the queue.
 *
 * Null means "dispatch as before": the flag is off, there is no tracked run to
 * key an alias on, the project already has MAX_PARALLEL_LANES_PER_PROJECT
 * lanes open, or the alias could not be persisted. Never throws.
 */
export async function planParallelRun(
  userId: string,
  runId: string | null | undefined,
  ctx: { projectKey: string; prompt: string },
): Promise<ParallelRunPlan | null> {
  if (!PARALLEL_DISPATCH_ENABLED || !runId) return null;

  const open = await countOpenParallelLanes(userId, ctx.projectKey, runId).catch(() => Infinity);
  if (open >= MAX_PARALLEL_LANES_PER_PROJECT) return null;

  const tab = deriveRunTab(ctx.projectKey, runId);
  // The alias is what the close path matches a pushed handoff on. Without it
  // persisted, a parallel run would finish and never close — worse than
  // waiting its turn — so any failure here keeps the queue.
  const stamped = await mergeRunPayload(runId, { sessionTab: tab }).catch((err: unknown) => {
    console.error("[parallel-run] sessionTab persist failed, keeping the queue:", err);
    return false;
  });
  if (!stamped) return null;

  return { tab, prompt: promptForLane(ctx.prompt, tab) };
}
