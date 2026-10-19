import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The hand-off from an approved partner's portal (on the studio site) to
 * Loki, where they sign in with OrangeCat and the application is tied to that
 * identity. The portal proves it holds the private key once, server-side; the
 * browser then carries only this short-lived signed id, never the key.
 */
const CONNECT_TTL_MS = 15 * 60 * 1000;

function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required for studio OrangeCat links");
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(`studio-orangecat:${payload}`).digest("base64url");
}

export function createStudioConnectToken(requestId: string, now = Date.now()): string {
  const payload = `${requestId}.${now + CONNECT_TTL_MS}`;
  return `${payload}.${signature(payload)}`;
}

export function studioConnectPath(requestId: string, now = Date.now()): string {
  return `/studio/connect?token=${encodeURIComponent(createStudioConnectToken(requestId, now))}`;
}

export function verifyStudioConnectToken(token: string, now = Date.now()): string | null {
  const [requestId, expiresRaw, supplied] = token.split(".");
  if (!requestId || !expiresRaw || !supplied || !/^\d+$/.test(expiresRaw)) return null;
  if (Number(expiresRaw) < now) return null;
  const expected = signature(`${requestId}.${expiresRaw}`);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? requestId : null;
}
