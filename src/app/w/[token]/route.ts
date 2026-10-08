import { NextResponse } from "next/server";
import { APP_URL } from "@/config/brand";
import { getFeedbackForTour, getFeedbackWithProject } from "@/db/queries/site-feedback";
import { livePageHref } from "@/lib/feedback/fix-shipping";
import { createTourToken, tourSiteUrl, verifyShareToken } from "@/lib/feedback/tour-token";

/**
 * A shared "Watch the fix": the link the owner hands to anyone. It opens the
 * live page with a fresh VIEWER ticket, so whoever receives it gets the same
 * walkthrough the owner watched — on the real site, not a recording — minus
 * the maintainer's reasoning, the PR and the reporter's screenshot.
 *
 * No session: the signed share token is the whole credential, and all it can
 * do is start that one walkthrough. A dead or unknown link lands on Loki's
 * front page rather than an error.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const home = NextResponse.redirect(APP_URL);
  const share = verifyShareToken(decodeURIComponent(token));
  if (!share) return home;
  const tour = await getFeedbackForTour(share.feedbackId);
  if (!tour) return home;
  // Read as the project owner: the share was theirs to give.
  const row = await getFeedbackWithProject(tour.feedback.userId, share.feedbackId);
  const live = row && livePageHref(row.liveUrl, row.feedback.url, row.feedback.page);
  if (!live) return home;
  return NextResponse.redirect(
    tourSiteUrl(live, createTourToken(share.feedbackId, Date.now(), "viewer")),
  );
}
