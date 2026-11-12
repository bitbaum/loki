/**
 * Following a chat build to live when nobody has its card open.
 *
 * A run reports when it closes, and it closes at a pull request: the change
 * is written, not shipped. The thread then said "done … it merges on its
 * own", and what happened next — it went live, or its deploy failed — was
 * found out only by a person who kept the dispatch card open, because the
 * ledger is refreshed by the card alone (lib/run-follow). Somebody who sent
 * a task from a phone and put the phone down was never told that it shipped.
 *
 * This is the same ledger, refreshed on the fifteen-minute cron that already
 * follows feedback fixes (crons/check-feedback-needs-you), for runs that came
 * from a conversation. It reads GitHub and the site's release receipt and
 * calls no model (scripts/test/no-free-background-ai.ts holds every timer to
 * that). On the change to live, or to a failed deploy, it writes one line
 * into the thread the task was sent from and sends one push.
 *
 * Old news is not announced: a ledger first read long after the change went
 * live is stamped and nothing is sent, so the first tick after this ships
 * does not report two days of history.
 */
import { and, desc, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { ORCHESTRATION_OUTCOME, orchestrationRuns } from "@/db/schema/orchestration-runs";
import { addMessage } from "@/db/queries/conversations";
import { logDebug } from "@/db/queries/debug-logs";
import { getFeedbackByRunId } from "@/db/queries/site-feedback";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { FIX_SHIP_STATE, fixNeedsRefresh, type FixShipping } from "@/lib/feedback/fix-shipping";
import { refreshFixShipping } from "@/lib/feedback/fix-shipping-refresh";
import { pushToUser } from "@/lib/push-fanout";
import { reportedPrEvidence } from "@/lib/repo-evidence";
import { chatRunAnnouncement, chatRunShippedMessage } from "@/lib/run-shipped-message";

/** The window lib/run-follow follows a run in; past it nothing is asked. */
export const CHAT_FOLLOW_WINDOW_MS = 48 * 60 * 60_000;
/** Runs looked at per tick: a rate limit on GitHub reads, newest first. */
const MAX_PER_TICK = 12;

type FollowResult = { looked: number; announced: number };

/**
 * One pass over the recent chat builds whose ledger can still change. Never
 * throws: a run that cannot be followed is skipped and the next tick tries
 * again.
 */
export async function followChatRuns(now: number = Date.now()): Promise<FollowResult> {
  const result: FollowResult = { looked: 0, announced: 0 };
  const runs = await db
    .select()
    .from(orchestrationRuns)
    .where(
      and(
        gt(orchestrationRuns.finishedAt, new Date(now - CHAT_FOLLOW_WINDOW_MS)),
        inArray(orchestrationRuns.outcome, [
          ORCHESTRATION_OUTCOME.SUCCESS,
          ORCHESTRATION_OUTCOME.PARTIAL,
        ]),
        sql`${orchestrationRuns.payload}->>'conversationId' IS NOT NULL`,
        sql`COALESCE(${orchestrationRuns.payload}->'fix'->>'state', '') NOT IN (${FIX_SHIP_STATE.DEPLOYED}, ${FIX_SHIP_STATE.PR_CLOSED})`,
      ),
    )
    .orderBy(desc(orchestrationRuns.finishedAt))
    .limit(MAX_PER_TICK);

  for (const run of runs) {
    try {
      const payload = (run.payload ?? {}) as {
        conversationId?: string;
        fix?: FixShipping;
        evidence?: { kind: string; url: string; title: string };
      };
      const conversationId = payload.conversationId;
      const before = payload.fix ?? null;
      if (!conversationId || !run.finishedAt || !fixNeedsRefresh(before)) continue;
      // A fix from the feedback inbox is announced by its own row
      // (feedback/attach-work); following it here would say it twice.
      if (await getFeedbackByRunId(run.userId, run.id).catch(() => null)) continue;
      const project = run.projectId
        ? await getUserProjectByEntityId(run.userId, run.projectId).catch(() => null)
        : null;
      const liveUrl = project?.liveUrl ?? null;
      result.looked += 1;
      const fix = await refreshFixShipping({
        runId: run.id,
        userId: run.userId,
        cached: before,
        summaryDone: (run.summary as { done?: string } | null)?.done ?? null,
        evidence: payload.evidence ?? reportedPrEvidence(run.payload, run.finishedAt.getTime()),
        gitUrl: project?.gitUrl ?? null,
        autoShip: null,
        deployBroken: false,
        runStartedAt: run.startedAt,
        liveUrl,
      });
      const announcement = chatRunAnnouncement(before, fix, now);
      if (!announcement) continue;
      const said = chatRunShippedMessage({
        announcement,
        projectKey: run.projectKey,
        fix,
        liveUrl,
      });
      await addMessage(conversationId, {
        role: "assistant",
        kind: "outcome",
        content: said.content,
        meta: { runId: run.id, prUrl: fix.pr?.url ?? null, shipped: announcement },
      });
      await pushToUser(run.userId, {
        title: said.title,
        body: said.body,
        // `?c=` names the thread (lib/loki/conversation-param).
        url: `/loki?c=${encodeURIComponent(conversationId)}`,
        tag: `run-shipped:${run.id}`,
      });
      result.announced += 1;
    } catch (e) {
      void logDebug({
        source: "run-follow-notify",
        level: "warn",
        message: `could not follow run ${run.id}: ${(e as Error).message}`,
      });
    }
  }
  return result;
}
