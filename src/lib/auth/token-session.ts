/**
 * A browser session opened with an agent's `ck_` token.
 *
 * An agent that holds a token can call the API with it, but a browser cannot
 * send a Bearer header on a page load, so /projects, /terminal and the rest
 * sent it to sign-in. The exchange closes that gap without handing the token
 * to the browser:
 *
 * 1. POST /api/token-session with `Authorization: Bearer ck_…` mints a link
 *    that opens ONCE, within LINK_TTL_SECONDS. The link carries a random code;
 *    the server keeps only its SHA-256.
 * 2. Opening it (GET /api/auth/loki/token-session, an AccountKit endpoint)
 *    creates a session for the token's user that ends after
 *    SESSION_TTL_SECONDS, is never refreshed, and is marked as the token's.
 *
 * A session opened this way has the token's power and no more:
 * - it reads what the user reads (pages, and GET on the API);
 * - it writes only where a token is accepted (getApiUserId / getApiActor):
 *   a write through a person-only route (getSessionUserId) reads as signed
 *   out, and the proxy marks such a write with TOKEN_SESSION_WRITE_HEADER;
 * - it never reaches the token list, a shell, the account's password, linked
 *   sign-ins or export (tokenSessionDenial), nor AccountKit's own account
 *   endpoints (passkeys, second factor) beyond reading and ending itself;
 * - when the token is revoked or expires, the session reads as signed out.
 */

export const LINK_TTL_SECONDS = 120;
export const SESSION_TTL_SECONDS = 60 * 60;

/** Set by the proxy on a write made with a token-opened session; stripped from every request otherwise. */
export const TOKEN_SESSION_WRITE_HEADER = "x-loki-token-session-write";

/** The AccountKit endpoint that opens a link, under /api/auth. */
export const TOKEN_SESSION_OPEN_PATH = "/loki/token-session";

/** AccountKit endpoints a token-opened session may call: read itself, end itself, open a link. */
export const TOKEN_SESSION_AUTH_PATHS: ReadonlySet<string> = new Set([
  "/get-session",
  "/sign-out",
  TOKEN_SESSION_OPEN_PATH,
]);

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method.toUpperCase());
}

/**
 * API prefixes a token-opened session never reaches, whatever the method.
 * Each is either a credential (tokens, password, linked sign-ins), a way to
 * keep access after the token is gone (minting a token), the account's whole
 * data (export), or the operator's shell.
 */
export const TOKEN_SESSION_DENIED_PREFIXES = [
  "/api/agent-tokens",
  "/api/event-stream-token",
  "/api/token-session",
  "/api/me/password",
  "/api/me/connected-accounts",
  "/api/me/export",
  "/api/shell",
] as const;

/** Why a token-opened session may not make this request, or null when it may. */
export function tokenSessionDenial(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "");
  for (const prefix of TOKEN_SESSION_DENIED_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return "A session opened with an agent token cannot do this. Sign in as a person.";
    }
  }
  return null;
}

/**
 * Where the link lands after it opens: a same-site path, never another
 * origin, never an auth endpoint. Anything else lands on "/".
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string") return "/";
  const value = next.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (/[\u0000-\u001f]/.test(value)) return "/";
  if (value.length > 500) return "/";
  if (value === "/api" || value.startsWith("/api/")) return "/";
  return value;
}
