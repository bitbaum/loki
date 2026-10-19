import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import type { SiteFeedback } from "@/db/schema";
import { FEEDBACK_SOURCE } from "@/lib/constants/statuses";
import { appUrl, feedbackReceivedTemplate, sendEmailFire } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { projectTitle } from "@/lib/project-display";
import { feedbackClaimPath } from "./claim-token";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A day's notes from one address: enough for a real person, and a cap on
 *  using the form to send mail to someone else's inbox. */
const RECEIPTS_PER_ADDRESS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A visitor left their email with a note: mail them the link to it.
 *
 * The widget's "Track what happens next" link lived only in that browser
 * tab, and following it later asked them to make an account. The link now
 * opens their report's status as it is (claim-feedback page, no account),
 * and this puts it where they will find it again. Fire-and-forget: a mail
 * problem never fails the note.
 */
export async function mailReceiptToVisitor(row: SiteFeedback): Promise<void> {
  try {
    if (row.source && row.source !== FEEDBACK_SOURCE.VISITOR) return;
    const to = row.contact?.trim().toLowerCase();
    if (!to || !EMAIL_RE.test(to)) return;
    if (!checkRateLimit(`feedback:receipt-mail:${to}`, RECEIPTS_PER_ADDRESS_PER_DAY, DAY_MS))
      return;
    const [project] = await db
      .select({ name: entities.name, title: entities.title, description: entities.description })
      .from(entities)
      .where(eq(entities.id, row.projectId))
      .limit(1);
    const site = project ? projectTitle(project) : "the site";
    const words = row.suggestion.replace(/\s+/g, " ").trim();
    const excerpt = words.length > 140 ? `${words.slice(0, 140)}…` : words;
    const mail = feedbackReceivedTemplate({
      site,
      excerpt,
      trackUrl: `${appUrl()}${feedbackClaimPath(row.id)}`,
    });
    sendEmailFire(to, mail.subject, mail.html, mail.text);
  } catch (err) {
    console.error("[feedback-receipt-mail]", err instanceof Error ? err.message : err);
  }
}
