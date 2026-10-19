import { createHmac, timingSafeEqual } from "node:crypto";

/** Half a year: the link is how a visitor with no account comes back, and it
 *  rides in the "your fix is live" mail, which can come weeks later. It shows
 *  only that one report's reporter-safe status (attach-reporter-view.ts). */
const CLAIM_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required for feedback claim links");
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(`feedback-claim:${payload}`).digest("base64url");
}

export function createFeedbackClaimToken(feedbackId: string, now = Date.now()): string {
  const payload = `${feedbackId}.${now + CLAIM_TTL_MS}`;
  return `${payload}.${signature(payload)}`;
}

/** Where a reporter claims a report: it lands in their own /my-feedback, so
 *  "what happened to what I said" always has an answer. One spelling for
 *  every route that hands one out (api/feedback, api/widget/self-report). */
export function feedbackClaimPath(feedbackId: string, now = Date.now()): string {
  return `/claim-feedback?token=${encodeURIComponent(createFeedbackClaimToken(feedbackId, now))}`;
}

export function verifyFeedbackClaimToken(token: string, now = Date.now()): string | null {
  const [feedbackId, expiresRaw, supplied] = token.split(".");
  if (!feedbackId || !expiresRaw || !supplied || !/^\d+$/.test(expiresRaw)) return null;
  if (Number(expiresRaw) < now) return null;
  const expected = signature(`${feedbackId}.${expiresRaw}`);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? feedbackId : null;
}
