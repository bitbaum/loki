/**
 * Tell the operator when feedback work needs them — stalled Implement, no
 * agent pickup, or a fix that is live and waiting for Check live / Confirm.
 *
 * Boss channel: Telegram (plus in-app alert). Same contract as
 * check-pending-approvals — one ping when the flag goes up, not per tick.
 */
import { sendTelegramMessage } from "@/lib/actions/telegram-send";
import { telegramTargetFor } from "@/lib/actions/telegram-for-user";
import { logDebug } from "@/db/queries/debug-logs";
import {
  refreshOrInsertActiveAlert,
  dismissActiveAlertsByType,
  getUserIdsWithActiveAlertType,
} from "@/db/queries/alerts";
import { listUserFeedback } from "@/db/queries/site-feedback";
import { attachFeedbackWork } from "@/lib/feedback/attach-work";
import { FEEDBACK_WORK_PHASE, WAITING_ON, type FeedbackWorkPhase } from "@/lib/feedback/work-phase";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { APP_URL } from "@/config/brand";
import { getFleetAutopilotUserIds } from "@/db/queries/beacon-settings";
import { needsYouDescription, needsYouTitle } from "./needs-you-words";

const ALERT_TYPE = "feedback_needs_you";

type NeedKind = "stuck" | "check_live";

function classify(phase: FeedbackWorkPhase, checkLive?: boolean): NeedKind | null {
  if (phase === FEEDBACK_WORK_PHASE.STUCK || phase === FEEDBACK_WORK_PHASE.FAILED) {
    return "stuck";
  }
  if (phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY && checkLive) {
    return "check_live";
  }
  return null;
}

export async function syncFeedbackNeedsYou(): Promise<{
  users: number;
  raised: number;
  pinged: number;
  cleared: number;
}> {
  const users = await getFleetAutopilotUserIds();
  const needing = new Set<string>();
  let raised = 0;
  let pinged = 0;

  for (const userId of users) {
    const raw = (await listUserFeedback(userId, 200)).filter(
      (f) => f.status === FEEDBACK_STATUS.DISPATCHED,
    );
    if (raw.length === 0) continue;
    const items = await attachFeedbackWork(userId, raw);
    const needs = items
      .map((f) => {
        if (f.work.waitingOn !== WAITING_ON.YOU) return null;
        const kind = classify(f.work.phase, f.work.checkLive);
        if (!kind) return null;
        return { f, kind, label: f.work.label, detail: f.work.detail };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    if (needs.length === 0) continue;
    needing.add(userId);

    const stuck = needs.filter((n) => n.kind === "stuck");
    const live = needs.filter((n) => n.kind === "check_live");
    const first = needs[0]!;
    const project = first.f.projectName;
    const title = needsYouTitle(stuck.length, live.length);
    const description = needsYouDescription(stuck.length, live.length);
    const total = stuck.length + live.length;

    const { created } = await refreshOrInsertActiveAlert(
      {
        userId,
        type: ALERT_TYPE,
        severity: stuck.length ? "warning" : "info",
        title,
        description,
        actionUrl: "/feedback",
        metadata: {
          stuck: stuck.length,
          checkLive: live.length,
          sampleProject: project,
        },
      },
      {
        // More waiting than when it went up: news again, so the bell dates
        // it now instead of the day the backlog first appeared.
        renew: (prev) => total > Number(prev?.stuck ?? 0) + Number(prev?.checkLive ?? 0),
      },
    );

    if (created) {
      raised++;
      const tg = await telegramTargetFor(userId);
      if (tg) {
        const lines = [
          `🧭 Loki: ${title}`,
          `${project}: ${first.label}${first.detail ? ` — ${first.detail}` : ""}`.slice(0, 320),
          `${APP_URL}/feedback?project=${encodeURIComponent(project)}`,
        ];
        const sent = await sendTelegramMessage(tg, lines.join("\n"));
        if (sent.ok) pinged++;
      }
    }
  }

  let cleared = 0;
  for (const userId of await getUserIdsWithActiveAlertType(ALERT_TYPE)) {
    if (needing.has(userId)) continue;
    cleared += await dismissActiveAlertsByType(userId, ALERT_TYPE);
  }

  void logDebug({
    source: "feedback/notify-needs-you",
    level: raised || pinged || cleared ? "warn" : "info",
    message: `users ${users.length}: raised ${raised}, pinged ${pinged}, cleared ${cleared}`,
    meta: { users: users.length, raised, pinged, cleared, needing: needing.size },
  });

  return { users: users.length, raised, pinged, cleared };
}
