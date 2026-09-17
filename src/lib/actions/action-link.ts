/**
 * One-tap action links — the approval queue, reachable from the lock screen.
 *
 * THE PROBLEM THIS SOLVES
 * The Telegram nag said `Approve or reject: https://loki…/approvals`. Acting on
 * it meant: open the link, sign in, find the row among the others, decide. Four
 * steps and a login to answer a yes/no question the message had already stated
 * in full. In practice the answer arrived hours later or not at all, which is
 * the same as no queue.
 *
 * A signed link collapses that to one tap. The token IS the authorisation —
 * exactly like the password-reset and feedback-claim links this app already
 * issues — so the decision needs no session and works on a phone that has
 * never logged into Loki.
 *
 * WHY THAT IS NOT A HOLE
 *  - It is scoped to ONE action id and ONE verb. A leaked approve-link for
 *    "Dentist, Friday 14:00" approves that event and nothing else — it is not
 *    a credential, it cannot be replayed against another row, and it cannot
 *    read anything.
 *  - It expires (LINK_TTL_MS), so an old chat backlog is inert.
 *  - It is single-use by consequence, not by bookkeeping: `approve` only moves
 *    a row out of `draft`, so a second tap finds nothing to do and says so.
 *  - It only ever travels to the self-only Telegram chat (telegram-send.ts
 *    refuses every other recipient).
 *
 * WHY GET EXECUTES. A tap in a chat client is a GET; putting a confirm button
 * behind it would restore the extra step this exists to delete. The rails above
 * are what make that acceptable, plus the fact that every verb here is either
 * reversible (approve → an event you can delete) or itself a refusal (reject).
 * Do not add a destructive verb to this file without changing that reasoning.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { APP_URL } from "@/config/brand";

/**
 * How long a link stays live. Matched to the queue's own reminder rhythm (the
 * hourly cron nags for up to DRAFT_MAX_AGE_DAYS), so a link never dies while
 * the thing it decides is still a live question — a dead link on a live draft
 * is the worst of both, since it teaches the operator the buttons don't work.
 */
export const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The verbs a link may carry. Each is reversible or is itself a refusal. */
export const ACTION_LINK_VERBS = ["approve", "reject"] as const;
export type ActionLinkVerb = (typeof ACTION_LINK_VERBS)[number];

export type ActionLinkClaim = { actionId: string; userId: string; verb: ActionLinkVerb };

function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required for one-tap action links");
  return value;
}

/**
 * Namespaced so a token minted here can never be mistaken for a feedback-claim
 * or private-zone token signed with the same AUTH_SECRET, and vice versa.
 */
function signature(payload: string): string {
  return createHmac("sha256", secret()).update(`action-link:${payload}`).digest("base64url");
}

export function createActionLinkToken(
  claim: ActionLinkClaim,
  now = Date.now(),
  ttlMs = LINK_TTL_MS,
): string {
  const payload = `${claim.actionId}.${claim.userId}.${claim.verb}.${now + ttlMs}`;
  return `${payload}.${signature(payload)}`;
}

/** Null for anything that is not a live, correctly-signed claim. No partial trust. */
export function verifyActionLinkToken(token: string, now = Date.now()): ActionLinkClaim | null {
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [actionId, userId, verb, expiresRaw, supplied] = parts;
  if (!actionId || !userId || !verb || !supplied || !/^\d+$/.test(expiresRaw)) return null;
  if (!(ACTION_LINK_VERBS as readonly string[]).includes(verb)) return null;
  if (Number(expiresRaw) < now) return null;

  const expected = signature(`${actionId}.${userId}.${verb}.${expiresRaw}`);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { actionId, userId, verb: verb as ActionLinkVerb };
}

/** Absolute URL for a one-tap decision. Absolute because it is read in Telegram. */
export function actionLinkUrl(claim: ActionLinkClaim, now = Date.now()): string {
  return `${APP_URL}/a/${createActionLinkToken(claim, now)}`;
}

/**
 * Where "Edit" goes. Editing is not one-tap by design — changing a time or a
 * recipient is composition, not a decision, so it opens the real queue with
 * this row expanded rather than pretending a chat button can do it.
 */
export function actionEditUrl(actionId: string): string {
  return `${APP_URL}/approvals?focus=${encodeURIComponent(actionId)}`;
}
