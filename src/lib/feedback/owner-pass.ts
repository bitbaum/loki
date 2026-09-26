import { createHmac, timingSafeEqual } from "node:crypto";
import { OWNER_PASS_HASH_KEY, ownerSiteUrl } from "../../../widget/owner-pass";

/**
 * The owner's pass for their own site's widget.
 *
 * The widget is anonymous by design — it posts cross-origin with a public
 * token — so a note from the owner looked exactly like one from a stranger and
 * waited in the inbox for the owner to come back to Loki and press Implement
 * on their own words. Loki's "Open your site" link carries this pass in the URL
 * fragment (never sent to any server); the widget keeps it for that site and
 * sends it with each note, and ingest starts the fix straight away.
 *
 * Scoped to one project and one owner, and it expires. What it grants is
 * exactly what the owner could do with one click in Loki: start an agent on
 * that project with that note.
 */

const OWNER_PASS_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required for owner passes");
  return value;
}

function signature(payload: string): string {
  // Domain-separated from the claim token, which signs with the same secret.
  return createHmac("sha256", secret()).update(`feedback-owner:${payload}`).digest("base64url");
}

export function createOwnerPass(projectId: string, userId: string, now = Date.now()): string {
  const payload = `${projectId}.${userId}.${now + OWNER_PASS_TTL_MS}`;
  return `${payload}.${signature(payload)}`;
}

export function verifyOwnerPass(
  pass: string,
  now = Date.now(),
): { projectId: string; userId: string } | null {
  const [projectId, userId, expiresRaw, supplied] = pass.split(".");
  if (!projectId || !userId || !expiresRaw || !supplied || !/^\d+$/.test(expiresRaw)) return null;
  if (Number(expiresRaw) < now) return null;
  const expected = signature(`${projectId}.${userId}.${expiresRaw}`);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? { projectId, userId } : null;
}

// The fragment key and the link shape are defined once, on the widget's side.
export { OWNER_PASS_HASH_KEY, ownerSiteUrl };
