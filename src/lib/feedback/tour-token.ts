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
 * no repository, no reasoning about code (lib/feedback/tour-plan.ts). The
 * viewer's is what the owner SHARES with anyone: the reporter's plain story
 * without the reporter's words or screenshot as theirs.
 */
export type TourAudience = "owner" | "reporter" | "viewer";

/** The owner opens it from Loki a moment after minting it. A reporter is
 *  handed it on /my-feedback and may come back to it days later. A viewer's
 *  ticket is minted by the share link on every open, so it need not last. */
const TOUR_TTL_MS: Record<TourAudience, number> = {
  owner: 24 * 60 * 60 * 1000,
  reporter: 7 * 24 * 60 * 60 * 1000,
  viewer: 24 * 60 * 60 * 1000,
};

/** Marker for a non-owner ticket. An owner ticket carries none, so every
 *  link minted before audiences existed still reads as the owner's. */
const AUDIENCE_MARK: Partial<Record<TourAudience, string>> = { reporter: "r", viewer: "v" };
const MARKED = new Map(
  Object.entries(AUDIENCE_MARK).map(([audience, mark]) => [mark, audience as TourAudience]),
);

function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required for fix walkthroughs");
  return value;
}

function signature(payload: string, domain = "feedback-tour"): string {
  return createHmac("sha256", secret()).update(`${domain}:${payload}`).digest("base64url");
}

function signatureMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createTourToken(
  feedbackId: string,
  now = Date.now(),
  audience: TourAudience = "owner",
): string {
  const base = `${feedbackId}.${now + TOUR_TTL_MS[audience]}`;
  // The mark is inside the signed payload, so a reporter or viewer ticket
  // cannot be promoted to the owner's by dropping it (nor the reverse).
  const mark = AUDIENCE_MARK[audience];
  const payload = mark ? `${base}.${mark}` : base;
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
  const audience = parts.length === 4 ? MARKED.get(parts[2]) : "owner";
  if (!audience) return null;
  if (!feedbackId || !expiresRaw || !supplied || !/^\d+$/.test(expiresRaw)) return null;
  if (Number(expiresRaw) < now) return null;
  const expected = signature(parts.slice(0, -1).join("."));
  return signatureMatches(supplied, expected) ? { feedbackId, audience } : null;
}

/**
 * The share link's key: a long-lived reference to one fix's walkthrough that
 * the owner hands to anyone. All it can do is mint a fresh VIEWER ticket
 * (app/w/[token]) — the plain story, with no maintainer's reasoning, PR or
 * reporter's screenshot. Signed in its own domain, so it is never a tour
 * ticket and a tour ticket is never one.
 */
const SHARE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SHARE_DOMAIN = "feedback-tour-share";

export function createShareToken(feedbackId: string, now = Date.now()): string {
  const payload = `${feedbackId}.${now + SHARE_TTL_MS}`;
  return `${payload}.${signature(payload, SHARE_DOMAIN)}`;
}

export function verifyShareToken(token: string, now = Date.now()): { feedbackId: string } | null {
  const [feedbackId, expiresRaw, supplied, ...rest] = token.split(".");
  if (rest.length || !feedbackId || !expiresRaw || !supplied || !/^\d+$/.test(expiresRaw)) {
    return null;
  }
  if (Number(expiresRaw) < now) return null;
  const expected = signature(`${feedbackId}.${expiresRaw}`, SHARE_DOMAIN);
  return signatureMatches(supplied, expected) ? { feedbackId } : null;
}

/** Loki's public address for a shared walkthrough (app/w/[token]). */
export function sharedWatchPath(shareToken: string): string {
  return `/w/${encodeURIComponent(shareToken)}`;
}

/** Loki's stable address for one fix's walkthrough: it mints a fresh ticket
 *  on every open (app/(app)/feedback/[id]/watch-fix), so a link in a message
 *  outlives the day a ticket lasts. */
export function watchFixPath(feedbackId: string): string {
  return `/feedback/${encodeURIComponent(feedbackId)}/watch-fix`;
}

// The fragment key and the link shape are defined once, on the widget's side.
export { TOUR_HASH_KEY, tourSiteUrl };
