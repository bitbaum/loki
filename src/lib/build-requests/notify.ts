import { selfTelegramTarget, sendTelegramMessage } from "@/lib/actions/telegram-send";
import { logDebug } from "@/db/queries/debug-logs";
import { refreshOrInsertActiveAlert } from "@/db/queries/alerts";
import { pushToUser } from "@/lib/push-fanout";
import { PUSH_TAG_PREFIX } from "@/config/brand-storage";
import { APP_URL } from "@/config/brand";
import { BUILD_REQUESTS } from "@/config/build-requests";
import type { BuildRequest } from "@/db/schema/build-requests";

/** Alert type — must match config/alert-types.ts. */
const ALERT_TYPE = "build_request";
const EXCERPT_MAX_CHARS = 160;

/**
 * Tell the operator a new account is waiting on a build. The visitor was just
 * told "a person reads it first", so a request that reaches nobody is a broken
 * promise: every configured channel, fire-and-forget, never throws, and a log
 * line when no channel reached anyone (same contract as studio/notify).
 */
export async function notifyBuildRequest(operatorId: string, row: BuildRequest): Promise<void> {
  try {
    const words = typeof row.brief.changes === "string" ? row.brief.changes.trim() : "";
    const excerpt = words
      ? words.length > EXCERPT_MAX_CHARS
        ? `${words.slice(0, EXCERPT_MAX_CHARS)}…`
        : words
      : "(the consultation's fixes)";
    const headline = `Build request for ${row.website}`;
    const [pushResult] = await Promise.all([
      pushToUser(operatorId, {
        title: headline,
        body: excerpt,
        url: BUILD_REQUESTS.reviewPath,
        tag: `${PUSH_TAG_PREFIX}build-request-${row.id}`,
      }),
      (async () => {
        const target = selfTelegramTarget();
        if (!target) return;
        const lines = [`🛠 ${headline}:`, `“${excerpt}”`, `${APP_URL}${BUILD_REQUESTS.reviewPath}`];
        await sendTelegramMessage(target, lines.join("\n")).catch(() => undefined);
      })(),
      refreshOrInsertActiveAlert({
        userId: operatorId,
        type: ALERT_TYPE,
        severity: "info",
        title: headline,
        description: `“${excerpt}” — approve or decline it.`,
        actionUrl: BUILD_REQUESTS.reviewPath,
      }),
    ]);
    if (pushResult.sent === 0 && !selfTelegramTarget()) {
      void logDebug({
        source: "build-requests/notify",
        level: "warn",
        message: `build request ${row.id} arrived with no reachable channel (push: ${pushResult.reason ?? "none"}, telegram: unconfigured)`,
      });
    }
  } catch (e) {
    void logDebug({
      source: "build-requests/notify",
      level: "warn",
      message: `build request notify failed for ${row.id}: ${(e as Error).message}`,
    });
  }
}
