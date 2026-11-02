import { notifyPerson } from "@/lib/notify/person";
import { getDefaultUser } from "@/db/queries/users";
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
    // The lists are the operator's: the person who installed this Loki.
    const operator = await getDefaultUser();
    if (!operator) return;
    const what = source.startsWith("bitbaum-hire") ? "🧾 Waitlist signup" : "📬 New subscriber";
    // The page promised a person writes back: one tap opens that email, addressed.
    const write = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(email)}`;
    const result = await notifyPerson(operator.id, {
      source: "newsletter",
      category: "people",
      text: `${what} — ${source}\n${email}`,
      buttons: [[{ text: "Write to them", url: write }]],
      key: `signup:${source}:${email}`,
    });
    // sendTelegramMessage REPORTS failure, it does not throw — so ignoring the
    // result swallows a dead channel silently, which is the exact failure this
    // function exists to prevent. Asked "did the signup reach anyone?", the
    // only honest answer must come from a log line, not from absence.
    if (!result.ok) {
      void logDebug({
        source: "newsletter/notify-signup",
        level: "warn",
        message: `signup via ${source} was not delivered: ${result.error ?? "unknown error"}`,
      });
    }
  } catch (e) {
    void logDebug({
      source: "newsletter/notify-signup",
      level: "warn",
      message: `signup notify failed for ${source}: ${(e as Error).message}`,
    });
  }
}
