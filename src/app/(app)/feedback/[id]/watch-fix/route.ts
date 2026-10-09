import { NextResponse } from "next/server";
import { APP_URL } from "@/config/brand";
import { getApiUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";
import { getFeedbackWithProject } from "@/db/queries/site-feedback";
import { livePageHref } from "@/lib/feedback/fix-shipping";
import { createTourToken, tourSiteUrl, watchFixPath } from "@/lib/feedback/tour-token";
import { getOrchestrationRunsByIds } from "@/db/queries/orchestration-runs";
import { runToFeedbackSnapshot } from "@/lib/feedback/attach-work";
import { deriveFeedbackWork } from "@/lib/feedback/work-phase";
import { ownerStatusFor } from "@/lib/feedback/owner-view";

/**
 * The link every "a fix is live" message carries: open the live page with the
 * walkthrough of that fix ("Watch the fix" — a cursor to each part, a caption
 * saying why). Operator, 2026-10-07: those explainer screens are "such a great
 * way to give users the sense of control", and the notification linked to the
 * bare homepage instead.
 *
 * A ticket lives a day, a Telegram message forever — so the message carries
 * THIS address, which mints a fresh ticket on every open. Never a dead end:
 * no live page or no access lands on the feedback inbox, which says why.
 *
 * And never a walkthrough of a change that is not there yet. The widget's
 * receipt carries this link the moment an agent starts, and this route used
 * to tour the unchanged page with "let me show you what changed" — the one
 * thing more confusing than no tour. While the change is still being built
 * the owner lands on the inbox row that says so.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inbox = NextResponse.redirect(`${APP_URL}/feedback`);
  if (!isValidUuid(id)) return inbox;
  const userId = await getApiUserId();
  if (!userId) {
    const back = encodeURIComponent(watchFixPath(id));
    return NextResponse.redirect(`${APP_URL}/sign-in?callbackUrl=${back}`);
  }
  const row = await getFeedbackWithProject(userId, id);
  if (!row) return inbox;
  const projectInbox = NextResponse.redirect(
    `${APP_URL}/feedback?project=${encodeURIComponent(row.projectName)}`,
  );
  const live = livePageHref(row.liveUrl, row.feedback.url, row.feedback.page);
  if (!live) return projectInbox;
  const runId = row.feedback.dispatchedRunId;
  const run = runId ? (await getOrchestrationRunsByIds(userId, [runId])).get(runId) : null;
  const status = ownerStatusFor(
    deriveFeedbackWork(row.feedback.status, runToFeedbackSnapshot(run)),
  );
  if (!status.live) return projectInbox;
  return NextResponse.redirect(tourSiteUrl(live, createTourToken(row.feedback.id)));
}
