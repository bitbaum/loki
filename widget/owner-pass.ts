/**
 * The owner's pass, as the widget sees it.
 *
 * Loki's "Open your site" link ends in `#loki-owner=<pass>`. The fragment never
 * reaches any server; the widget lifts it out of the address bar, keeps it for
 * this site (per widget token), and sends it with each note so Loki knows the
 * owner is speaking and starts the fix. The server verifies it; this side only
 * carries it. Name shared with src/lib/feedback/owner-pass.ts.
 */
export const OWNER_PASS_HASH_KEY = "loki-owner";

const storageKey = (token: string) => `loki-owner:${token}`;

/** The owner's link to their own site: the live URL with the pass in the
 *  fragment (never a query string — a fragment is not sent to any server). */
export function ownerSiteUrl(liveUrl: string, pass: string): string {
  const base = liveUrl.split("#")[0];
  return `${base}#${OWNER_PASS_HASH_KEY}=${encodeURIComponent(pass)}`;
}

/** Read a pass from the URL fragment, if this visit brought one. */
export function passFromHash(hash: string): string | null {
  const raw = hash.replace(/^#/, "");
  for (const part of raw.split("&")) {
    const [k, v] = part.split("=");
    if (k === OWNER_PASS_HASH_KEY && v) {
      try {
        return decodeURIComponent(v);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The fragment with the pass removed, so it is not left in the address bar
 *  where a copied link would hand it to someone else. */
export function hashWithoutPass(hash: string): string {
  const kept = hash
    .replace(/^#/, "")
    .split("&")
    .filter((part) => part && part.split("=")[0] !== OWNER_PASS_HASH_KEY);
  return kept.length ? `#${kept.join("&")}` : "";
}

/**
 * Pick up a pass arriving in the URL (store it, clean the address bar) and
 * return the pass this browser holds for this site, if any.
 */
export function takeOwnerPass(token: string): { pass: string | null; arrived: boolean } {
  const arriving = passFromHash(location.hash);
  if (arriving) {
    try {
      localStorage.setItem(storageKey(token), arriving);
    } catch {
      /* private mode: the pass still works for this page view */
    }
    try {
      history.replaceState(
        history.state,
        "",
        location.pathname + location.search + hashWithoutPass(location.hash),
      );
    } catch {
      /* sandboxed frame */
    }
    return { pass: arriving, arrived: true };
  }
  try {
    return { pass: localStorage.getItem(storageKey(token)), arrived: false };
  } catch {
    return { pass: null, arrived: false };
  }
}

/** A pass the server refused (expired, revoked): stop sending it. */
export function forgetOwnerPass(token: string): void {
  try {
    localStorage.removeItem(storageKey(token));
  } catch {
    /* nothing stored */
  }
}
