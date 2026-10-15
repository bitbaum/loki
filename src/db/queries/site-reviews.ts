import { createHash } from "node:crypto";
import { and, eq, desc, asc, sql, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  siteReviews,
  siteReviewEvents,
  type SiteReview,
  type SiteReviewEvent,
} from "@/db/schema/site-reviews";
import { REVIEW_LIMITS } from "@/lib/inspection/contract";

export const reviewTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function getSiteReview(userId: string, id: string) {
  return (
    (
      await db
        .select()
        .from(siteReviews)
        .where(and(eq(siteReviews.id, id), eq(siteReviews.userId, userId)))
        .limit(1)
    )[0] ?? null
  );
}
export async function getWorkerReview(id: string, token: string) {
  const row = (
    await db
      .select()
      .from(siteReviews)
      .where(and(eq(siteReviews.id, id), eq(siteReviews.tokenHash, reviewTokenHash(token))))
      .limit(1)
  )[0];
  return row && Date.now() - row.createdAt.getTime() < REVIEW_LIMITS.lifetimeMs ? row : null;
}
export async function latestSiteReview(userId: string, projectId: string) {
  return (
    (
      await db
        .select()
        .from(siteReviews)
        .where(and(eq(siteReviews.userId, userId), eq(siteReviews.projectId, projectId)))
        .orderBy(desc(siteReviews.createdAt))
        .limit(1)
    )[0] ?? null
  );
}
export async function reviewEvents(userId: string, reviewId: string) {
  return db
    .select()
    .from(siteReviewEvents)
    .where(and(eq(siteReviewEvents.userId, userId), eq(siteReviewEvents.reviewId, reviewId)))
    .orderBy(asc(siteReviewEvents.createdAt))
    .limit(REVIEW_LIMITS.events);
}
export async function updateSiteReview(
  row: SiteReview,
  patch: Partial<
    Pick<SiteReview, "status" | "workerId" | "workerState" | "heartbeatAt" | "frame" | "coverage">
  >,
) {
  return (
    await db
      .update(siteReviews)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(siteReviews.id, row.id), eq(siteReviews.userId, row.userId)))
      .returning()
  )[0];
}
export async function addReviewEvent(
  row: SiteReview,
  event: Pick<SiteReviewEvent, "kind" | "text"> &
    Partial<Pick<SiteReviewEvent, "finding" | "image" | "runId">>,
) {
  return db.transaction(async (tx) => {
    const reserved = await tx
      .update(siteReviews)
      .set({
        eventCount: sql`${siteReviews.eventCount} + 1`,
        findingCount:
          event.kind === "finding"
            ? sql`${siteReviews.findingCount} + 1`
            : sql`${siteReviews.findingCount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(siteReviews.id, row.id),
          eq(siteReviews.userId, row.userId),
          lt(siteReviews.eventCount, REVIEW_LIMITS.events),
          event.kind === "finding"
            ? lt(siteReviews.findingCount, REVIEW_LIMITS.findings)
            : undefined,
        ),
      )
      .returning({ id: siteReviews.id });
    if (!reserved.length && event.kind === "finding") return null;
    if (!reserved.length)
      throw new Error(
        "This review has reached its observation limit. Start another review to continue.",
      );
    return (
      await tx
        .insert(siteReviewEvents)
        .values({ ...event, userId: row.userId, reviewId: row.id })
        .returning()
    )[0];
  });
}
/** Strip the worker capability before anything reaches the browser. */
export function publicReview(row: SiteReview) {
  const { tokenHash: _token, workerId: _worker, ...view } = row;
  void _token;
  void _worker;
  return {
    ...view,
    frame: row.frame
      ? {
          ...row.frame,
          image: `/api/reviews/${row.id}/frame?key=${reviewImageKey(row.frame.image)}`,
        }
      : null,
  };
}

export const reviewImageKey = (image: string) => createHash("sha256").update(image).digest("hex");
export function publicReviewEvents(events: SiteReviewEvent[]) {
  return events.map((event) => ({
    ...event,
    image: event.image ? `/api/reviews/${event.reviewId}/frame?event=${event.id}` : null,
  }));
}
