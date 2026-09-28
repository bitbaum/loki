import { DEFAULT_PLACEMENT, normalizePlacement, type Placement } from "./placement";

/**
 * The visitor's own placement, per token, in localStorage.
 *
 * Scoped by token so a person who moved the launcher on one customer's site
 * does not silently move it on another. Every access is wrapped: Safari in
 * private mode throws on localStorage, and a widget that cannot render because
 * storage is unavailable would be a worse bug than one that forgets a
 * preference.
 */
const VISITOR_KEY = (token: string) => `fc-widget-pos:${token.slice(0, 24)}`;

export function readVisitorPlacement(token: string): Placement | null {
  try {
    const raw = localStorage.getItem(VISITOR_KEY(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    // `hidden` is stored as a placement with a marker so one key covers both
    // "moved it" and "dismissed it".
    if (parsed && typeof parsed === "object" && (parsed as { hidden?: boolean }).hidden) {
      return readHiddenMarker();
    }
    return normalizePlacement(parsed);
  } catch {
    return null;
  }
}

export function writeVisitorPlacement(
  token: string,
  value: Placement | { hidden: true } | null,
): void {
  try {
    if (value === null) localStorage.removeItem(VISITOR_KEY(token));
    else localStorage.setItem(VISITOR_KEY(token), JSON.stringify(value));
  } catch {
    /* storage unavailable — the preference just doesn't persist */
  }
}

/** The in-memory form of "the visitor hid this" (see isHiddenByVisitor). */
export function readHiddenMarker(): Placement {
  return { ...DEFAULT_PLACEMENT, autoAvoid: false, offsetX: -1 };
}

/** offsetX === -1 is the in-memory marker for "visitor hid this". */
export function isHiddenByVisitor(p: Placement | null): boolean {
  return !!p && p.offsetX === -1;
}

/** The fragment that brings a hidden launcher back: `https://site/page#loki`. */
export const RESTORE_HASH = "loki";

/**
 * Did this visit ask for the launcher back? Reads `#loki` (alone or among other
 * `&`-joined fragment parts), then removes it from the address bar so a copied
 * link does not carry it. A fragment never reaches any server, so this works on
 * every host without a deploy.
 */
export function restoreRequested(): boolean {
  const parts = location.hash.replace(/^#/, "").split("&");
  if (!parts.includes(RESTORE_HASH)) return false;
  const kept = parts.filter((p) => p && p !== RESTORE_HASH);
  try {
    history.replaceState(
      history.state,
      "",
      location.pathname + location.search + (kept.length ? `#${kept.join("&")}` : ""),
    );
  } catch {
    /* sandboxed frame — the fragment just stays */
  }
  return true;
}
