/**
 * The access code in front of every prospect preview, and the cookie that
 * remembers a visitor entered it.
 *
 * One code for all previews, read from the box env (LOKI_PREVIEW_CODE), so it
 * is changed in one place. The cookie is an HMAC under AUTH_SECRET over its
 * expiry AND a fingerprint of the code it was issued for: change the code and
 * every earlier cookie stops opening anything, without a list to revoke.
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { PREVIEWS } from "@/config/previews";

const DOMAIN = "preview-access";

/** Spaces, dashes and case do not matter when typing a code. */
export function normalizePreviewCode(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "");
}

/** The configured code, normalized, or null when previews are switched off. */
export function configuredPreviewCode(): string | null {
  const raw = process.env.LOKI_PREVIEW_CODE;
  const code = raw ? normalizePreviewCode(raw) : "";
  return code || null;
}

/**
 * The code that opens one preview: its owner's own (set in the app), else the
 * server's. Normalized, or null when previews are switched off for it.
 */
export function previewCodeFor(ownerCode?: string | null): string | null {
  const own = ownerCode ? normalizePreviewCode(ownerCode) : "";
  return own || configuredPreviewCode();
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time comparison of what was typed against the configured code. */
export function previewCodeMatches(input: string, configured = configuredPreviewCode()): boolean {
  if (!configured) return false;
  return timingSafeEqual(digest(normalizePreviewCode(input)), digest(configured));
}

function secret(): string | null {
  return (process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET)?.trim() || null;
}

function fingerprint(code: string): string {
  return createHash("sha256").update(`${DOMAIN}:code:${code}`).digest("base64url").slice(0, 16);
}

function sign(expiresAt: number, code: string, key: string): string {
  return createHmac("sha256", key)
    .update(`${DOMAIN}:${expiresAt}:${fingerprint(code)}`)
    .digest("base64url");
}

/** `<expiresAt>.<sig>`, or null when there is no code or no secret to sign with. */
export function createPreviewAccessCookie(
  now = Date.now(),
  code = configuredPreviewCode(),
): string | null {
  const key = secret();
  if (!code || !key) return null;
  const expiresAt = now + PREVIEWS.cookieTtlMs;
  return `${expiresAt}.${sign(expiresAt, code, key)}`;
}

export function verifyPreviewAccessCookie(
  value: string | undefined,
  now = Date.now(),
  code = configuredPreviewCode(),
): boolean {
  const key = secret();
  if (!value || !code || !key) return false;
  const [expRaw, sig, extra] = value.split(".");
  if (!expRaw || !sig || extra !== undefined) return false;
  const expiresAt = Number(expRaw);
  if (!Number.isSafeInteger(expiresAt) || now > expiresAt) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(expiresAt, code, key));
  return a.length === b.length && timingSafeEqual(a, b);
}
