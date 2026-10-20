import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A project member's pass for the project's own site — the seat, carried to
 * the widget.
 *
 * The owner pass (owner-pass.ts) turns the widget into the owner's console:
 * Watch, the changes list, Build all. A client is not the owner, and the only
 * way to put their words on the site used to be handing them the owner's own
 * link — a bearer key that acted as the owner for 90 days, for whoever it was
 * forwarded to. This pass names the PERSON instead. The widget stays the
 * ordinary panel; it sends the pass with each note, and ingest files the note
 * as theirs, with their seat's rules (the owner decides; "Make it live" for a
 * change built for them).
 *
 * Membership is read when the pass is used, never trusted from the pass:
 * removing someone from the project ends what their pass can do at once.
 */

const MEMBER_PASS_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function signature(payload: string): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for member passes");
  // Domain-separated from the owner pass, the agent pass and the claim token.
  return createHmac("sha256", secret).update(`feedback-member:${payload}`).digest("base64url");
}

export function createMemberPass(projectId: string, userId: string, now = Date.now()): string {
  const payload = `${projectId}.${userId}.${now + MEMBER_PASS_TTL_MS}`;
  return `${payload}.${signature(payload)}`;
}

/** Who the pass names, for THIS project, if it is genuine and unexpired. */
export function verifyMemberPass(
  pass: string | null | undefined,
  projectId: string,
  now = Date.now(),
): { userId: string } | null {
  if (!pass) return null;
  const [passProject, userId, expiresRaw, supplied] = pass.split(".");
  if (passProject !== projectId || !userId || !expiresRaw || !supplied) return null;
  if (!/^\d+$/.test(expiresRaw) || Number(expiresRaw) < now) return null;
  const a = Buffer.from(supplied);
  const b = Buffer.from(signature(`${passProject}.${userId}.${expiresRaw}`));
  return a.length === b.length && timingSafeEqual(a, b) ? { userId } : null;
}
