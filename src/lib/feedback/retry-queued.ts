/**
 * One automatic cold-start retry for feedback that sits Queued with no pickup.
 *
 * Prefer actually starting the work: if cloud/Hermes never claimed, close the
 * undelivered run and Implement once more (same path as Retry). Stamp
 * payload.feedbackAutoRetriedAt so we never loop. After that, Telegram via
 * notify-needs-you is the honest escalate.
 */
import {
  listUserFeedback,
  setFeedbackStatus,
  getFeedbackWithProject,
} from "@/db/queries/site-feedback";
import {
  getOrchestrationRunById,
  closeRunUndelivered,
  stampFeedbackAutoRetried,
} from "@/db/queries/orchestration-runs";
import { getFleetAutopilotUserIds } from "@/db/queries/beacon-settings";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { attachFeedbackWork } from "@/lib/feedback/attach-work";
import { FEEDBACK_WORK_PHASE } from "@/lib/feedback/work-phase";
import { injectPrompt } from "@/lib/inject-core";
import { composeFeedbackFixPrompt } from "@/lib/feedback/compose-dispatch";
import { feedbackInjectAccepted } from "@/lib/feedback/dispatch-accept";
import { DEFAULT_ADAPTER_ID, ORCHESTRATION_ADAPTER_IDS, type AdapterId } from "@/lib/orchestration";
import { getCurrentClaudeSessionForProject } from "@/db/queries/agent-sessions";
import { logDebug } from "@/db/queries/debug-logs";

const IMPLEMENT_ADAPTERS = ORCHESTRATION_ADAPTER_IDS.filter((id) => id !== "openclaw");

function resolveAdapter(agentPref: string | null | undefined): AdapterId {
  const pref =
    agentPref === "antigravity" || agentPref === "agy" ? "gemini" : agentPref;
  if (pref && (IMPLEMENT_ADAPTERS as readonly string[]).includes(pref)) {
    return pref as AdapterId;
  }
  return DEFAULT_ADAPTER_ID;
}

export async function autoRetryStuckFeedbackQueues(): Promise<{
  users: number;
  retried: number;
  skipped: number;
}> {
  const users = await getFleetAutopilotUserIds();
  let retried = 0;
  let skipped = 0;

  for (const userId of users) {
    const raw = (await listUserFeedback(userId, 100)).filter(
      (f) => f.status === FEEDBACK_STATUS.DISPATCHED && !!f.dispatchedRunId,
    );
    if (raw.length === 0) continue;
    const items = await attachFeedbackWork(userId, raw);

    for (const item of items) {
      if (item.work.phase !== FEEDBACK_WORK_PHASE.STUCK) {
        skipped++;
        continue;
      }
      // Only undelivered / never-started — not auth-blocked or stalled mid-run.
      const run = item.dispatchedRunId
        ? await getOrchestrationRunById(userId, item.dispatchedRunId)
        : null;
      if (!run) {
        skipped++;
        continue;
      }
      const payload = (run.payload ?? {}) as {
        deliveredAt?: string;
        feedbackAutoRetriedAt?: string;
        blocked?: string;
      };
      if (payload.deliveredAt || payload.blocked === "auth") {
        skipped++;
        continue;
      }
      if (payload.feedbackAutoRetriedAt) {
        skipped++;
        continue;
      }

      // Stamp before re-inject so a crash mid-retry cannot loop forever.
      await stampFeedbackAutoRetried(run.id, userId).catch(() => null);

      await closeRunUndelivered(
        run.id,
        userId,
        "Auto-retry: no builder claimed the queued Implement",
      ).catch(() => null);

      const row = await getFeedbackWithProject(userId, item.id);
      if (!row?.hasWorkspace) {
        skipped++;
        continue;
      }
      const adapter = resolveAdapter(row.agentPref);
      const currentSession =
        adapter === "claude"
          ? await getCurrentClaudeSessionForProject(
              userId,
              row.projectName,
              new Date(),
              row.feedback.projectId,
            )
          : null;

      const { status, body } = await injectPrompt(
        {
          tab: row.projectName,
          projectId: row.feedback.projectId,
          allowHostedFallback: true,
          refuseOfflineQueue: true,
          adapter,
          sessionId: currentSession?.sessionId,
          customPrompt: composeFeedbackFixPrompt(row.feedback, row.projectName),
          notifyOnClose: true,
        },
        userId,
      );

      const accepted = feedbackInjectAccepted(status, body);
      if (accepted && body.runId) {
        await setFeedbackStatus(userId, item.id, FEEDBACK_STATUS.DISPATCHED, body.runId);
        // Carry the retry stamp onto the NEW run so a second cron tick does not
        // fire again before the starting window elapses.
        await stampFeedbackAutoRetried(run.id, userId).catch(() => null);
        retried++;
      } else {
        skipped++;
      }
    }
  }

  void logDebug({
    source: "feedback/retry-queued",
    level: retried ? "warn" : "info",
    message: `auto-retry stuck queues: retried ${retried}, skipped ${skipped}, users ${users.length}`,
    meta: { users: users.length, retried, skipped },
  });

  return { users: users.length, retried, skipped };
}
