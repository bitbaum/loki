import { createHash, timingSafeEqual } from "node:crypto";
import { COMMISSION } from "@/config/commission";
import { StudioAccessKey } from "@/config/studio";

export function studioHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function studioBearer(request: Request): string | null {
  const match = /^Bearer (spt_[A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}
export function studioKeyMatches(key: string, hash: string): boolean {
  if (!StudioAccessKey.safeParse(key).success || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(studioHash(key), "hex"), Buffer.from(hash, "hex"));
}
export function studioOriginAllowed(request: Request, required = false): boolean {
  const origin = request.headers.get("origin");
  return origin === COMMISSION.studioOrigin || (!required && origin === null);
}
export function studioHeaders(request: Request): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === COMMISSION.studioOrigin) {
    headers.set("Access-Control-Allow-Origin", COMMISSION.studioOrigin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

/** Compare browser writes with the canonical external app origin, not the
 * internal bind address supplied by the reverse proxy. */
export function studioReviewOriginAllowed(request: Request, publicBaseUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(publicBaseUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Headers for what the studio site reads WITH the reader's Loki session: who
 * is signed in, and the owner's private list. bitbaum.orangecat.ch and
 * loki.orangecat.ch are one site, so the page's `credentials: "include"`
 * fetch carries the session cookie; only that one origin may read the answer.
 *
 * The origin is named, never echoed and never "*": a wildcard cannot carry
 * credentials, and an echo would hand the answer to every sibling subdomain
 * (a customer preview, another product). GET only: these routes change
 * nothing, so there is nothing for a forged request to do.
 */
export const STUDIO_SESSION_HEADERS = {
  "Access-Control-Allow-Origin": COMMISSION.studioOrigin,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
  Vary: "Origin, Cookie",
} as const;

/**
 * A page of the studio site to send someone back to, from a `to` in a link.
 *
 * Only a path, only in the shape the static site serves (lowercase directory
 * names, a trailing slash), and always on the studio's own origin: never a
 * host, a scheme, a "//" or a backslash, so the return cannot be turned into
 * a redirect to somewhere else. Anything that does not fit is the home page.
 */
export function studioReturnUrl(to: string | null | undefined): string {
  const path =
    typeof to === "string" && /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/){0,4}$/.test(to) ? to : "/";
  return `${COMMISSION.studioOrigin}${path}`;
}
