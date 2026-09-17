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
      return { ...DEFAULT_PLACEMENT, autoAvoid: false, offsetX: -1 };
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

/** offsetX === -1 is the in-memory marker for "visitor hid this". */
export function isHiddenByVisitor(p: Placement | null): boolean {
  return !!p && p.offsetX === -1;
}
