/**
 * CORS for the handful of public endpoints another site of ours may call.
 *
 * The feedback widget answers `Access-Control-Allow-Origin: *` because it
 * authenticates with a write-only token; origin secrecy buys it nothing. The
 * newsletter/waitlist capture has no token at all, so it gets the opposite
 * treatment: an explicit allowlist of our own front ends, echoed back one
 * origin at a time. A wildcard there would let any page on the internet post
 * into the list from a visitor's browser.
 *
 * `Vary: Origin` is not optional — without it a cache can hand the headers
 * computed for one origin to a request from another.
 */

/** Front ends allowed to post to the public capture endpoints. */
export const PUBLIC_POST_ORIGINS = [
  "https://bitbaum.orangecat.ch",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

export function isAllowedPublicOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return (PUBLIC_POST_ORIGINS as readonly string[]).includes(origin.trim());
}

/**
 * Headers for a cross-origin response. An origin we do not know gets no ACAO
 * at all, which is what makes the browser refuse the response — the request
 * itself is still rate-limited and still validated server-side.
 */
export function publicCorsHeaders(origin: string | null | undefined): Record<string, string> {
  const base: Record<string, string> = { Vary: "Origin" };
  if (!isAllowedPublicOrigin(origin)) return base;
  return {
    ...base,
    "Access-Control-Allow-Origin": (origin as string).trim(),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
