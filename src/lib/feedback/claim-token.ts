import { createHmac, timingSafeEqual } from "node:crypto";

const CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

export function verifyFeedbackClaimToken(token: string, now = Date.now()): string | null {
  const [feedbackId, expiresRaw, supplied] = token.split(".");
  if (!feedbackId || !expiresRaw || !supplied || !/^\d+$/.test(expiresRaw)) return null;
  if (Number(expiresRaw) < now) return null;
  const expected = signature(`${feedbackId}.${expiresRaw}`);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? feedbackId : null;
}
