import { selfTelegramTarget, sendTelegramMessage } from "@/lib/actions/telegram-send";
import { logDebug } from "@/db/queries/debug-logs";

/**
 * Tell the operator someone joined a list.
 *
 * newsletter_subscribers was capture-only from the start: a row went in and
 * nothing said so, which is fine for a newsletter nobody has sent yet and
 * wrong for the /hire/ waitlist, where the page promises a human will write
 * back when capacity opens. A promise kept by a table nobody queries is the
 * same failure as the address that bounced silently for months.
 *
 * Mirrors notifyFeedbackReceived: fire on the insert choke point, every
 * failure swallowed, never slows the response. Only genuinely new rows
 * announce — a repeat signup is a no-op and announcing it would train the
 * operator to ignore the channel.
 */
export async function notifyNewsletterSignup(email: string, source: string): Promise<void> {
  try {
    const target = selfTelegramTarget();
    if (!target) {
      // An announcement that reached NOBODY is worth a log line, not silence:
      // the page promised a reply.
      void logDebug({
        source: "newsletter/notify-signup",
        level: "warn",
        message: `signup via ${source} arrived with no reachable channel (telegram: unconfigured)`,
      });
      return;
    }
    const what = source.startsWith("bitbaum-hire") ? "🧾 Waitlist signup" : "📬 New subscriber";
    await sendTelegramMessage(target, `${what} — ${source}\n${email}`);
  } catch (e) {
    void logDebug({
      source: "newsletter/notify-signup",
      level: "warn",
      message: `signup notify failed for ${source}: ${(e as Error).message}`,
    });
  }
}
