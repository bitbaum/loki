/**
 * Invitations into one project — the rules, with no database.
 *
 * Kept pure so every decision that grants access to someone else's project can
 * be tested without a DATABASE_URL. The query layer (db/queries/project-access)
 * only stores and loads; whether an invite may be accepted is decided here.
 */

import { createHash, randomBytes } from "node:crypto";

/** How long an unaccepted invite stays usable. */
export const PROJECT_INVITE_TTL_DAYS = 14;

/** The link a person opens to accept. The raw token lives only in this URL. */
export function projectInvitePath(token: string): string {
  return `/invite/project/${token}`;
}

/** 32 random bytes, URL-safe. The raw token is shown once and never stored. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database keeps instead of the token. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Emails compare case-insensitively and without surrounding space. */
export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + PROJECT_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export type InviteState = {
  email: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};

export type InviteVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: "revoked" | "accepted" | "expired" | "wrong-account" | "no-email";
      /** What to show the person holding the link. */
      message: string;
    };

/**
 * May the signed-in person accept this invite?
 *
 * The token alone is not enough. A link is a bearer secret that gets forwarded,
 * pasted into chats and left in inboxes; tying acceptance to the invited email
 * means a forwarded link opens nothing for the wrong person. They are told
 * which address it was for — partly masked, because the link itself may be in
 * the wrong hands.
 *
 * Order matters: a revoked or already-used invite says so even to the right
 * person, rather than "wrong account" — the honest answer to "why can't I get
 * in" is the state of the invite, not their identity.
 */
export function evaluateInviteAcceptance(
  invite: InviteState,
  sessionEmail: string | null | undefined,
  now: Date = new Date(),
): InviteVerdict {
  if (invite.revokedAt) {
    return {
      ok: false,
      reason: "revoked",
      message: "This invitation was withdrawn by the project owner.",
    };
  }
  if (invite.acceptedAt) {
    return { ok: false, reason: "accepted", message: "This invitation has already been used." };
  }
  if (invite.expiresAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      reason: "expired",
      message: "This invitation has expired. Ask the project owner to send a new one.",
    };
  }
  if (!sessionEmail?.trim()) {
    return {
      ok: false,
      reason: "no-email",
      message: "Your account has no email address, so this invitation cannot be matched to it.",
    };
  }
  if (normalizeInviteEmail(sessionEmail) !== normalizeInviteEmail(invite.email)) {
    return {
      ok: false,
      reason: "wrong-account",
      message: `This invitation is for ${maskEmail(invite.email)}. Sign in with that account to accept it.`,
    };
  }
  return { ok: true };
}

/**
 * "georgbotsmann@gmail.com" → "ge•••@gmail.com".
 *
 * Enough for the right person to recognise their own address, not enough to
 * hand a stranger holding a forwarded link someone's full email.
 */
export function maskEmail(email: string): string {
  const [local, domain] = normalizeInviteEmail(email).split("@");
  if (!domain) return "•••";
  return `${local.slice(0, 2)}•••@${domain}`;
}
