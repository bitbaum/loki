import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import type { SiteFeedback } from "@/db/schema";
import { sendTelegramMessage } from "@/lib/actions/telegram-send";
import { telegramTargetFor } from "@/lib/actions/telegram-for-user";
import { logDebug } from "@/db/queries/debug-logs";
import { pushToUser } from "@/lib/push-fanout";
import { PUSH_TAG_PREFIX } from "@/config/brand-storage";
import { APP_URL } from "@/config/brand";
import { FEEDBACK_SOURCE } from "@/lib/constants/statuses";
import { refreshOrInsertActiveAlert } from "@/db/queries/alerts";

/** Longest suggestion excerpt a new-feedback notification carries. */
const EXCERPT_MAX_CHARS = 160;

/** Alert type for new feedback — must match config/alert-types.ts. */
const ALERT_TYPE = "new_feedback";

/**
 * Tell the operator a visitor just filed feedback.
 *
 * Ingest was persist-first with "notification later" from day one
 * (docs/architecture/feedback-widget.md) — and "later" never came, so the only
 * way to learn a visitor reported something was to go open the inbox. This is
 * the missing half: fire on the insert choke point in POST /api/feedback,
 * mirroring notifyRunClosed (every configured channel, fire-and-forget, never
 * throws, never slows the ingest response).
 *
 * Only genuine visitor rows announce. AI-review and synthesizer filings arrive
 * in bursts the operator just asked for — announcing each would train them to
 * ignore the channel. Duplicate bumps stay silent too: the row was announced
 * when it was first filed.
 */
/** Rows that announce when filed: a visitor's note and a seat's ask. */
const ANNOUNCED_SOURCES: ReadonlySet<string> = new Set([
  FEEDBACK_SOURCE.VISITOR,
  FEEDBACK_SOURCE.CLIENT,
  FEEDBACK_SOURCE.MEMBER,
]);

export async function notifyFeedbackReceived(row: SiteFeedback): Promise<void> {
  try {
    // A seat's ask waits for the owner, so it announces like a visitor's.
    if (row.source && !ANNOUNCED_SOURCES.has(row.source)) return;

    const [project] = await db
      .select({ name: entities.name })
      .from(entities)
      .where(eq(entities.id, row.projectId))
      .limit(1);
    const projectName = project?.name ?? "a project";

    const excerpt =
      row.suggestion.length > EXCERPT_MAX_CHARS
        ? `${row.suggestion.slice(0, EXCERPT_MAX_CHARS)}…`
        : row.suggestion;
    const where = row.page ?? row.url;
    const inboxPath = `/feedback?project=${encodeURIComponent(projectName)}`;
    const telegram = await telegramTargetFor(row.userId);

    const [pushResult] = await Promise.all([
      pushToUser(row.userId, {
        title: `${projectName} · new feedback`,
        body: excerpt,
        url: inboxPath,
        tag: `${PUSH_TAG_PREFIX}feedback-${row.projectId}`,
      }),
      (async () => {
        const target = telegram;
        if (!target) return;
        const lines = [
          `📨 New feedback on ${projectName}${where ? ` (${where})` : ""}:`,
          `“${excerpt}”`,
          `${APP_URL}${inboxPath}`,
        ];
        await sendTelegramMessage(target, lines.join("\n")).catch(() => undefined);
      })(),
      (async () => {
        await refreshOrInsertActiveAlert({
          userId: row.userId,
          type: ALERT_TYPE,
          severity: "info",
          title: "New feedback needs triage",
          description: `${projectName}: "${excerpt}"`,
          actionUrl: inboxPath,
        });
      })(),
    ]);

    // Same contract as notify-close: an announcement that reached NOBODY is a
    // product failure worth a log line, not a silent no-op.
    if (pushResult.sent === 0 && !telegram) {
      void logDebug({
        source: "feedback/notify-new",
        level: "warn",
        message: `feedback ${row.id} arrived with no reachable channel (push: ${pushResult.reason ?? "none"}, telegram: unconfigured)`,
      });
    }
  } catch (e) {
    void logDebug({
      source: "feedback/notify-new",
      level: "warn",
      message: `new-feedback notify failed for ${row.id}: ${(e as Error).message}`,
    });
  }
}
