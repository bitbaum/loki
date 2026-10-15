/**
 * After a Loki chat build finishes: where its change is now, and — once it
 * is live — whether it shows. The server half of RunFollow (run-handoff.ts).
 *
 * Asked only by the chat card a person has open (the live-status routes it
 * polls), never by a timer: the look spends the owner's AI budget, and
 * scripts/test/no-free-background-ai.ts holds every scheduled path to none.
 *
 * It reuses the feedback inbox's machinery rather than a second copy: the PR
 * ledger (refreshFixShipping, throttled by fixNeedsRefresh, never merging —
 * the repo's own path decides that) and the live-page look (lookAndRecord).
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { promptHistory } from "@/db/schema/prompt-history";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { checkAiBudget } from "@/lib/ai-budget/gate";
import { FIX_SHIP_STATE, fixNeedsRefresh, type FixShipping } from "@/lib/feedback/fix-shipping";
import { refreshFixShipping } from "@/lib/feedback/fix-shipping-refresh";
import { lookAndRecord } from "@/lib/feedback/verify-live";
import { ORCHESTRATION_OUTCOME } from "@/lib/orchestration/contract";
import { runFollow, type RunFollow } from "@/lib/run-handoff";

type FollowableRun = {
  id: string;
  projectId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: string | null;
  summary: { done?: string } | null;
  payload: unknown;
};

/**
 * Only a recent run is followed. Opening an old thread renders every past
 * dispatch card at once; without this, each would ask GitHub again and any
 * deployed-but-unread one would spend the owner's budget on a look at a
 * change from weeks ago. Older cards show what their ledger already says.
 */
export const FOLLOW_WINDOW_MS = 48 * 60 * 60_000;

/** One look per run at a time: the card polls, and the look takes seconds. */
const looking = new Set<string>();

async function askedFor(userId: string, runId: string): Promise<string | null> {
  const [row] = await db
    .select({ custom: promptHistory.customPrompt, resolved: promptHistory.resolvedPrompt })
    .from(promptHistory)
    .where(and(eq(promptHistory.userId, userId), eq(promptHistory.runId, runId)))
    .orderBy(desc(promptHistory.dispatchedAt))
    .limit(1);
  // What was asked, not the operator preamble resolved_prompt is wrapped in.
  return row?.custom ?? row?.resolved ?? null;
}

export async function followRun(
  userId: string,
  run: FollowableRun,
  now: number = Date.now(),
): Promise<RunFollow | null> {
  const finishedWell =
    !!run.finishedAt &&
    (run.outcome === ORCHESTRATION_OUTCOME.SUCCESS ||
      run.outcome === ORCHESTRATION_OUTCOME.PARTIAL);
  if (!finishedWell) return null;
  const payload = (run.payload ?? {}) as {
    fix?: FixShipping;
    evidence?: { kind: string; url: string; title: string };
  };
  const project = run.projectId
    ? await getUserProjectByEntityId(userId, run.projectId).catch(() => null)
    : null;
  let fix = payload.fix ?? null;
  const liveUrl = project?.liveUrl ?? null;
  if (now - run.finishedAt!.getTime() > FOLLOW_WINDOW_MS) return runFollow(fix, liveUrl, run.id);
  if (fixNeedsRefresh(fix)) {
    fix = await refreshFixShipping({
      runId: run.id,
      userId,
      cached: fix,
      summaryDone: run.summary?.done ?? null,
      evidence: payload.evidence ?? null,
      gitUrl: project?.gitUrl ?? null,
      autoShip: null,
      deployBroken: false,
      runStartedAt: run.startedAt,
    }).catch(() => fix);
  }
  if (
    fix &&
    fix.state === FIX_SHIP_STATE.DEPLOYED &&
    !fix.verify &&
    liveUrl &&
    !looking.has(run.id)
  ) {
    looking.add(run.id);
    try {
      const budget = await checkAiBudget(userId).catch(() => ({ allowed: false as const }));
      const report = (await askedFor(userId, run.id)) ?? run.summary?.done ?? "";
      const verify = await lookAndRecord(userId, run.id, fix, liveUrl, budget.allowed, {
        report,
        didLine: run.summary?.done ?? null,
        selector: null,
        pointedAt: null,
      });
      fix = { ...fix, verify };
    } finally {
      looking.delete(run.id);
    }
  }
  return runFollow(fix, liveUrl, run.id);
}
