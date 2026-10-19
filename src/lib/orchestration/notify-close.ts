import { sendTelegramMessage } from "@/lib/actions/telegram-send";
import { telegramTargetFor } from "@/lib/actions/telegram-for-user";
import { logDebug } from "@/db/queries/debug-logs";
import { formatRunCloseMessage, runCloseButtons } from "@/lib/orchestration/notify-close-format";
import { postRunOutcomeToConversation } from "@/lib/orchestration/run-outcome-post";
import { pushToUser } from "@/lib/push-fanout";
import { PUSH_TAG_PREFIX } from "@/config/brand-storage";
import type { OrchestrationRun } from "@/db/schema/orchestration-runs";

/**
 * Tell the operator their dispatch finished.
 *
 * A dispatch is an asynchronous job a human started and then walked away from —
 * that is the whole point of having an always-on builder. Clicking Send and
 * receiving nothing back is the failure users describe as "I don't know if it
 * worked": the run completed, the result exists, and the only way to learn that
 * was to still be staring at the tab.
 *
 * Every CONFIGURED channel is used, not the first one that happens to exist.
 * This shipped Telegram-only and returned early when TELEGRAM_CHAT_ID was
 * unset — which it is in production — so the notification silently went
 * nowhere even for runs that had opted in. Web push is the channel that
 * reaches the installed PWA on the operator's phone, which is exactly where
 * someone who dispatched and pocketed the device is looking.
 *
 * Runs still opt in via payload.notifyOnClose, so autopilot churn stays silent;
 * see markHumanInitiated for who sets it.
 *
 * Fire-and-forget by contract: called as `void notifyRunClosed(...)` from the
 * close choke points, must never throw or slow a close. The message logic lives
 * in notify-close-format.ts (pure, unit-tested).
 */
export async function notifyRunClosed(run: OrchestrationRun): Promise<void> {
  // The thread that asked for the work is a channel too — the one the person
  // is most likely still looking at. Independent of push/Telegram configuration.
  void postRunOutcomeToConversation(run);
  try {
    const message = formatRunCloseMessage(run);
    if (!message) return;

    const telegram = await telegramTargetFor(run.userId);
    const [pushResult] = await Promise.all([
      pushToUser(run.userId, {
        title: `${run.projectKey} · ${run.outcome ?? "closed"}`,
        body: message.split("\n").slice(1).join(" ").slice(0, 240) || "Run finished",
        url: `/control?focus=${encodeURIComponent(run.projectKey)}`,
        tag: `${PUSH_TAG_PREFIX}${run.projectKey}`,
      }),
      (async () => {
        const target = telegram;
        if (!target) return;
        await sendTelegramMessage(target, message, { buttons: runCloseButtons(run) }).catch(
          () => undefined,
        );
      })(),
    ]);

    // A run that opted into being announced and reached NOBODY is a product
    // failure, not a no-op. Record it so the gap is discoverable from the logs
    // instead of being inferred from the operator never hearing anything.
    if (pushResult.sent === 0 && !telegram) {
      void logDebug({
        source: "orchestration/notify-close",
        level: "warn",
        message: `run ${run.id} closed with no reachable channel (push: ${pushResult.reason ?? "none"}, telegram: unconfigured)`,
      });
    }
  } catch (e) {
    void logDebug({
      source: "orchestration/notify-close",
      level: "warn",
      message: `run-close notify failed for ${run.id}: ${(e as Error).message}`,
    });
  }
}
