import { createHmac, timingSafeEqual } from "node:crypto";
import { TOUR_HASH_KEY, tourSiteUrl } from "../../../widget/tour";

/**
 * The ticket for "Watch the fix": a signed, expiring reference to ONE
 * feedback item, carried to the live site in the URL fragment (never sent to
 * that site's server). What it grants is a walkthrough of that item's fix —
 * the report's words and the agent's one-line account — and the right to flag
 * a step the walkthrough could not show. Nothing that changes the project.
 *
 * Same shape as the claim token and the owner pass, domain-separated so none
 * of the three can stand in for another.
 */

const TOUR_TTL_MS = 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required for fix walkthroughs");
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(`feedback-tour:${payload}`).digest("base64url");
}

export function createTourToken(feedbackId: string, now = Date.now()): string {
  const payload = `${feedbackId}.${now + TOUR_TTL_MS}`;
  return `${payload}.${signature(payload)}`;
}

export function verifyTourToken(token: string, now = Date.now()): string | null {
  const [feedbackId, expiresRaw, supplied] = token.split(".");
  if (!feedbackId || !expiresRaw || !supplied || !/^\d+$/.test(expiresRaw)) return null;
  if (Number(expiresRaw) < now) return null;
  const expected = signature(`${feedbackId}.${expiresRaw}`);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? feedbackId : null;
}

// The fragment key and the link shape are defined once, on the widget's side.
export { TOUR_HASH_KEY, tourSiteUrl };
