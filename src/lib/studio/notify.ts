import { selfTelegramTarget, sendTelegramMessage } from "@/lib/actions/telegram-send";
import { logDebug } from "@/db/queries/debug-logs";
import { pushToUser } from "@/lib/push-fanout";
import { PUSH_TAG_PREFIX } from "@/config/brand-storage";
import { APP_URL } from "@/config/brand";
import { refreshOrInsertActiveAlert } from "@/db/queries/alerts";
import type { StudioRequest } from "@/db/schema/studio-requests";

/** Longest excerpt of a visitor's words a notification carries. */
const EXCERPT_MAX_CHARS = 160;

/** Alert type for studio activity — must match config/alert-types.ts. */
const ALERT_TYPE = "studio_request";

/** What a guest did, in the operator's words. */
const HEADLINE: Record<string, string> = {
  received_website: "New studio brief",
  received_partner: "New partner application",
  message: "A reply on a studio request",
  accept_preview: "A preview was accepted",
  request_changes: "Changes requested on a preview",
  submit_assessment: "Course evidence submitted",
  propose_profile: "A partner profile proposed",
  set_availability: "A partner changed availability",
  deliver_assignment: "An assigned preview delivered",
};

/**
 * Tell the studio a visitor or partner did something on a studio request.
 *
 * The studio portal (#995) persisted every brief, application and reply and
 * told nobody: a request sat unread until someone opened /feedback/studio by
 * chance — the same gap feedback had before notify-new, now with people who
 * were promised a reply from a person. This is the same contract as
 * notifyFeedbackReceived: every configured channel, fire-and-forget, never
 * throws, never slows the ingest response, and a log line when no channel
 * could reach anyone.
 */
export async function notifyStudioActivity(
  row: StudioRequest,
  action: string,
  words: string,
): Promise<void> {
  try {
    const kind = action === "received" ? `received_${row.kind}` : action;
    const headline = HEADLINE[kind] ?? "Activity on a studio request";
    const excerpt =
      words.length > EXCERPT_MAX_CHARS ? `${words.slice(0, EXCERPT_MAX_CHARS)}…` : words;
    const where = row.website ? ` (${row.website})` : "";
    const reviewPath = `/feedback/studio?request=${encodeURIComponent(row.id)}`;

    const [pushResult] = await Promise.all([
      pushToUser(row.userId, {
        title: `Studio · ${headline}`,
        body: excerpt,
        url: reviewPath,
        tag: `${PUSH_TAG_PREFIX}studio-${row.id}`,
      }),
      (async () => {
        const target = selfTelegramTarget();
        if (!target) return;
        const lines = [`🏛 ${headline}${where}:`, `“${excerpt}”`, `${APP_URL}${reviewPath}`];
        await sendTelegramMessage(target, lines.join("\n")).catch(() => undefined);
      })(),
      refreshOrInsertActiveAlert({
        userId: row.userId,
        type: ALERT_TYPE,
        severity: "info",
        title: headline,
        description: `${row.kind === "partner" ? "Application" : "Brief"}${where}: "${excerpt}"`,
        actionUrl: reviewPath,
      }),
    ]);

    // An announcement that reached NOBODY is a product failure worth a log
    // line, not a silent no-op — a person was promised a reply.
    if (pushResult.sent === 0 && !selfTelegramTarget()) {
      void logDebug({
        source: "studio/notify",
        level: "warn",
        message: `studio request ${row.id} (${kind}) arrived with no reachable channel (push: ${pushResult.reason ?? "none"}, telegram: unconfigured)`,
      });
    }
  } catch (e) {
    void logDebug({
      source: "studio/notify",
      level: "warn",
      message: `studio notify failed for ${row.id}: ${(e as Error).message}`,
    });
  }
}
