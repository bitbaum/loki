import { createHash } from "node:crypto";
import { clientIp, slidingWindow, toHeaders, type LimitResult } from "limitkit";

/**
 * Rate limits, as limitkit decisions. In-memory and per process: the right
 * size for blunting scripted abuse on one box, the wrong size for billing.
 *
 * KEYED ON THE PROXY'S HOP, NEVER THE FIRST X-Forwarded-For ENTRY. limitkit's
 * `clientIp()` reads the LAST hop — the one Caddy appended, which the caller
 * cannot choose. Seven fleet limiters keyed on the first hop and could be
 * walked past by sending a fresh value per request (fleet SHARED.md, limitkit
 * row). `trustedProxies: 1` is Caddy on the box.
 */
export const limits = {
  /** Guessing a password, a code or a passkey assertion. */
  credential: slidingWindow({ limit: 10, windowMs: 15 * 60_000 }),
  /** Anything that sends an email: protects people's inboxes and the shared quota. */
  mail: slidingWindow({ limit: 5, windowMs: 60 * 60_000 }),
  /** The same, per recipient, so rotating IPs cannot flood one inbox. */
  mailTo: slidingWindow({ limit: 3, windowMs: 60 * 60_000 }),
  /** Everything else under /api/auth (session reads, sign-out, listing). */
  auth: slidingWindow({ limit: 300, windowMs: 10 * 60_000 }),
  /** The example model route: a shared free budget, per person. */
  ai: slidingWindow({ limit: 20, windowMs: 60 * 60_000 }),
  /** Checking a key against a vendor. */
  modelProbe: slidingWindow({ limit: 20, windowMs: 10 * 60_000 }),
};

export type Bucket = "credential" | "mail" | "auth";

const MAIL = new Set([
  "/sign-up/email",
  "/sign-in/magic-link",
  "/send-verification-email",
  "/request-password-reset",
  "/forget-password",
  "/change-email",
]);

const CREDENTIAL_PREFIXES = [
  "/sign-in/email",
  "/sign-in/social",
  "/reset-password",
  "/change-password",
  "/verify-password",
  "/two-factor/",
  "/passkey/verify-authentication",
  "/passkey/generate-authenticate-options",
  "/magic-link/verify",
  "/delete-user",
];

/** Which bucket a better-auth path (after /api/auth) spends from. */
export function authBucket(path: string): Bucket {
  if (MAIL.has(path)) return "mail";
  if (CREDENTIAL_PREFIXES.some((p) => path === p || path.startsWith(p))) return "credential";
  return "auth";
}

export function callerKey(headers: Headers, scope: string): string {
  return `${scope}:${clientIp(headers, { trustedProxies: 1 })}`;
}

/** A recipient as a bucket key: hashed, so the limiter never holds an address. */
export function recipientKey(email: string): string {
  return `mail-to:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
}

export function tooMany(result: LimitResult): Response {
  return Response.json(
    { error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds },
    { status: 429, headers: { ...toHeaders(result), "Cache-Control": "no-store" } },
  );
}
