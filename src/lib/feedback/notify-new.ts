import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities, siteFeedback } from "@/db/schema";
import type { SiteFeedback } from "@/db/schema";
import { selfTelegramTarget, sendTelegramMessage } from "@/lib/actions/telegram-send";
import { logDebug } from "@/db/queries/debug-logs";
import { pushToUser } from "@/lib/push-fanout";
import { PUSH_TAG_PREFIX } from "@/config/brand-storage";
import { APP_URL } from "@/config/brand";
import { FEEDBACK_SOURCE } from "@/lib/constants/statuses";
import { refreshOrInsertActiveAlert } from "@/db/queries/alerts";
import { getUserById } from "@/db/queries/users";
import { watchFixPath } from "@/lib/feedback/tour-token";

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
export async function notifyFeedbackReceived(row: SiteFeedback): Promise<void> {
  try {
    if (row.source && row.source !== FEEDBACK_SOURCE.VISITOR) return;

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

    const [pushResult] = await Promise.all([
      pushToUser(row.userId, {
        title: `${projectName} · new feedback`,
        body: excerpt,
        url: inboxPath,
        tag: `${PUSH_TAG_PREFIX}feedback-${row.projectId}`,
      }),
      (async () => {
        const target = selfTelegramTarget();
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
    if (pushResult.sent === 0 && !selfTelegramTarget()) {
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

/**
 * A Builder asked for a change on the site and Loki started on it without
 * the owner. The owner is told, not asked: that is the deal the invite page
 * states ("nothing waits for them"), and the one line here is what keeps
 * the owner in the loop. Same channels as a visitor's report.
 */
export async function notifyBuilderAsked(
  feedbackId: string,
  builderUserId: string,
  building: boolean,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        ownerUserId: siteFeedback.userId,
        projectId: siteFeedback.projectId,
        suggestion: siteFeedback.suggestion,
        projectName: entities.name,
      })
      .from(siteFeedback)
      .innerJoin(entities, eq(entities.id, siteFeedback.projectId))
      .where(eq(siteFeedback.id, feedbackId))
      .limit(1);
    if (!row) return;
    const builder = (await getUserById(builderUserId))?.name?.trim() || "A builder";
    const excerpt =
      row.suggestion.length > EXCERPT_MAX_CHARS
        ? `${row.suggestion.slice(0, EXCERPT_MAX_CHARS)}…`
        : row.suggestion;
    const path = building
      ? watchFixPath(feedbackId)
      : `/feedback?project=${encodeURIComponent(row.projectName)}`;
    const what = building ? "Loki is building it." : "It waits in Feedback — it could not start.";
    await Promise.all([
      pushToUser(row.ownerUserId, {
        title: `${row.projectName} · ${builder} asked for a change`,
        body: `“${excerpt}” — ${what}`,
        url: path,
        tag: `${PUSH_TAG_PREFIX}feedback-${row.projectId}`,
      }),
      (async () => {
        const target = selfTelegramTarget();
        if (!target) return;
        await sendTelegramMessage(
          target,
          [
            `🛠 ${builder} asked for a change on ${row.projectName}:`,
            `“${excerpt}”`,
            what,
            `${APP_URL}${path}`,
          ].join("\n"),
        ).catch(() => undefined);
      })(),
    ]);
  } catch (e) {
    void logDebug({
      source: "feedback/notify-new",
      level: "warn",
      message: `builder-asked notify failed for ${feedbackId}: ${(e as Error).message}`,
    });
  }
}
