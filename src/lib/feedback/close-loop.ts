import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { entities, siteFeedback } from "@/db/schema";
import { FEEDBACK_SOURCE, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { appUrl, feedbackShippedTemplate, sendEmailFire } from "@/lib/email";
import { feedbackClaimPath } from "@/lib/feedback/claim-token";

/**
 * Close the feedback loop honestly.
 *
 * "Shipped" / Done is not "the agent run closed SUCCESS". That used to
 * auto-resolve rows (and email visitors) the moment inject→run finished —
 * which claimed the live product changed when only a prompt had been
 * delivered and a session had ended. Resolve is now an operator (or later
 * live-stamp / merged-PR) act; the visitor email fires from that path.
 *
 * `resolveFeedbackForRun` remains for a future evidence-gated closer
 * (merged PR / deploy stamp). Do not call it from a bare SUCCESS close.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ShippableRow = {
  id: string;
  contact: string | null;
  suggestion: string;
  page: string | null;
  projectId: string;
  source: string | null;
};

async function emailVisitorShipped(row: ShippableRow): Promise<void> {
  // Only real visitors get the "your feedback shipped" email — agent-filed
  // rows (AI review / synthesizer) have no one to notify. Explicit guard;
  // the EMAIL_RE check below also catches the legacy contact strings.
  if (row.source && row.source !== FEEDBACK_SOURCE.VISITOR) return;
  const contact = row.contact?.trim();
  if (!contact || !EMAIL_RE.test(contact)) return;
  const [project] = await db
    .select({ name: entities.name })
    .from(entities)
    .where(eq(entities.id, row.projectId))
    .limit(1);
  const site = project?.name ?? "the site";
  const excerpt = row.suggestion.length > 140 ? `${row.suggestion.slice(0, 140)}…` : row.suggestion;
  const mail = feedbackShippedTemplate({
    site,
    excerpt,
    page: row.page,
    trackUrl: `${appUrl()}${feedbackClaimPath(row.id)}`,
  });
  sendEmailFire(contact, mail.subject, mail.html, mail.text);
}

/** Operator (or evidence) marked the row resolved — tell the visitor once. */
export async function notifyFeedbackShipped(feedbackId: string): Promise<void> {
  try {
    const [row] = await db
      .select({
        id: siteFeedback.id,
        contact: siteFeedback.contact,
        suggestion: siteFeedback.suggestion,
        page: siteFeedback.page,
        projectId: siteFeedback.projectId,
        source: siteFeedback.source,
        status: siteFeedback.status,
      })
      .from(siteFeedback)
      .where(eq(siteFeedback.id, feedbackId))
      .limit(1);
    if (!row || row.status !== FEEDBACK_STATUS.RESOLVED) return;
    await emailVisitorShipped(row);
  } catch (err) {
    console.error("[feedback-close-loop]", err instanceof Error ? err.message : err);
  }
}

/**
 * Evidence-gated closer: flip dispatched rows for this run to resolved and
 * email visitors. Call only with real ship evidence (merged PR / live stamp),
 * never from a bare SUCCESS run close.
 */
export async function resolveFeedbackForRun(runId: string): Promise<void> {
  try {
    const resolved = await db
      .update(siteFeedback)
      .set({ status: FEEDBACK_STATUS.RESOLVED, resolvedAt: new Date() })
      .where(
        and(
          eq(siteFeedback.dispatchedRunId, runId),
          eq(siteFeedback.status, FEEDBACK_STATUS.DISPATCHED),
        ),
      )
      .returning({
        id: siteFeedback.id,
        contact: siteFeedback.contact,
        suggestion: siteFeedback.suggestion,
        page: siteFeedback.page,
        projectId: siteFeedback.projectId,
        source: siteFeedback.source,
      });

    for (const row of resolved) {
      await emailVisitorShipped(row);
    }
  } catch (err) {
    // The run-close path must survive a feedback hiccup untouched.
    console.error("[feedback-close-loop]", err instanceof Error ? err.message : err);
  }
}
