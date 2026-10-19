/**
 * A project member's pass, as the widget sees it (src/lib/feedback/member-pass.ts).
 *
 * The client's "Open the site" link in Loki ends in `#loki-member=<pass>`.
 * Unlike the owner pass it changes nothing about the panel: the widget keeps
 * it for this site and sends it with each note, so the note is filed as the
 * member's own. The server decides what their seat allows.
 */
export const MEMBER_PASS_HASH_KEY = "loki-member";

const storageKey = (token: string) => `loki-member:${token}`;

export function memberSiteUrl(liveUrl: string, pass: string): string {
  const base = liveUrl.split("#")[0];
  return `${base}#${MEMBER_PASS_HASH_KEY}=${encodeURIComponent(pass)}`;
}

function fromHash(hash: string): string | null {
  for (const part of hash.replace(/^#/, "").split("&")) {
    const [k, v] = part.split("=");
    if (k === MEMBER_PASS_HASH_KEY && v) {
      try {
        return decodeURIComponent(v);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Pick up a pass arriving in the URL (keep it, clean the address bar) and
 *  return the one this browser holds for this site, if any. */
export function takeMemberPass(token: string): string | null {
  const arriving = fromHash(location.hash);
  if (arriving) {
    try {
      localStorage.setItem(storageKey(token), arriving);
    } catch {
      /* private mode: it still works for this page view */
    }
    const kept = location.hash
      .replace(/^#/, "")
      .split("&")
      .filter((p) => p && p.split("=")[0] !== MEMBER_PASS_HASH_KEY);
    try {
      history.replaceState(
        history.state,
        "",
        location.pathname + location.search + (kept.length ? `#${kept.join("&")}` : ""),
      );
    } catch {
      /* a sandboxed frame: the pass is still held */
    }
    return arriving;
  }
  try {
    return localStorage.getItem(storageKey(token));
  } catch {
    return null;
  }
}

/** The server no longer honours it (removed from the project, expired). */
export function forgetMemberPass(token: string): void {
  try {
    localStorage.removeItem(storageKey(token));
  } catch {
    /* nothing kept */
  }
}
