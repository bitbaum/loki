import { createHmac, timingSafeEqual } from "node:crypto";
import { TOUR_HASH_KEY, tourSiteUrl } from "../../../widget/tour";

/**
 * The ticket for "Watch the fix": a signed, expiring reference to ONE
 * feedback item, carried to the live site in the URL fragment (never sent to
 * that site's server). What it grants is a walkthrough of that item's fix —
 * the report's words and the agent's account of the change — and the right to flag
 * a step the walkthrough could not show. Nothing that changes the project.
 *
 * Same shape as the claim token and the owner pass, domain-separated so none
 * of the three can stand in for another.
 */

/**
 * Who the walkthrough is for. The owner's tells the whole story — why, what
 * else was considered, the PR — and ends at "confirm in Loki". The reporter's
 * is the same change in plain words, with nothing of the maintainer's: no PR,
 * no repository, no reasoning about code (lib/feedback/tour-plan.ts).
 */
export type TourAudience = "owner" | "reporter";

/** The owner opens it from Loki a moment after minting it. A reporter is
 *  handed it on /my-feedback and may come back to it days later. */
const TOUR_TTL_MS: Record<TourAudience, number> = {
  owner: 24 * 60 * 60 * 1000,
  reporter: 7 * 24 * 60 * 60 * 1000,
};

/** Marker for a reporter ticket. An owner ticket carries none, so every
 *  link minted before audiences existed still reads as the owner's. */
const REPORTER_MARK = "r";

function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required for fix walkthroughs");
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(`feedback-tour:${payload}`).digest("base64url");
}

export function createTourToken(
  feedbackId: string,
  now = Date.now(),
  audience: TourAudience = "owner",
): string {
  const base = `${feedbackId}.${now + TOUR_TTL_MS[audience]}`;
  // The mark is inside the signed payload, so a reporter ticket cannot be
  // promoted to the owner's by dropping it (nor the reverse by adding it).
  const payload = audience === "reporter" ? `${base}.${REPORTER_MARK}` : base;
  return `${payload}.${signature(payload)}`;
}

export function verifyTourToken(
  token: string,
  now = Date.now(),
): { feedbackId: string; audience: TourAudience } | null {
  const parts = token.split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [feedbackId, expiresRaw] = parts;
  const supplied = parts[parts.length - 1];
  const audience: TourAudience = parts.length === 4 ? "reporter" : "owner";
  if (parts.length === 4 && parts[2] !== REPORTER_MARK) return null;
  if (!feedbackId || !expiresRaw || !supplied || !/^\d+$/.test(expiresRaw)) return null;
  if (Number(expiresRaw) < now) return null;
  const expected = signature(parts.slice(0, -1).join("."));
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? { feedbackId, audience } : null;
}

// The fragment key and the link shape are defined once, on the widget's side.
export { TOUR_HASH_KEY, tourSiteUrl };
