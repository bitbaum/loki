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

/**
 * Fired on `window` whenever `Loki.hidden` changes (detail: `{ hidden }`), so
 * a host's own on/off switch stays in step with the menu inside the widget.
 * Loki's account menu listens for it (src/lib/open-feedback.ts).
 */
export const VISIBILITY_EVENT = "loki:visibility";

/**
 * Fired on `window` whenever `Loki.status` changes (detail: the new status), so
 * a host that draws its own launcher (`data-fc-place="host"`) can show the
 * same state the floating button would: whether Loki is watching, and how
 * many things it said while the panel was closed.
 */
export const STATUS_EVENT = "loki:status";

/** What a host-drawn launcher shows. `owner` is false for an ordinary visitor,
 *  who gets the quiet launcher: no watching state, no count. */
export type LauncherStatus = { owner: boolean; watching: boolean; unread: number };

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

/**
 * Where the person dragged the launcher on this site: which side edge it is
 * snapped to, and how far down that edge (0 = top, 1 = bottom of the room the
 * button has). A fraction rather than pixels so the spot survives a rotate or
 * a resized window. Scoped per token like the placement above.
 */
export type DragPosition = { side: "left" | "right"; y: number };

const DRAG_KEY = (token: string) => `fc-widget-drag:${token.slice(0, 24)}`;

export function readDragPosition(token: string): DragPosition | null {
  try {
    const raw = localStorage.getItem(DRAG_KEY(token));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<DragPosition>;
    if ((v.side !== "left" && v.side !== "right") || typeof v.y !== "number" || !isFinite(v.y))
      return null;
    return { side: v.side, y: Math.min(1, Math.max(0, v.y)) };
  } catch {
    return null;
  }
}

export function writeDragPosition(token: string, value: DragPosition | null): void {
  try {
    if (value === null) localStorage.removeItem(DRAG_KEY(token));
    else localStorage.setItem(DRAG_KEY(token), JSON.stringify(value));
  } catch {
    /* storage unavailable — the spot just doesn't persist */
  }
}

/**
 * Whether the person minimized the launcher on this site: the owner's wide
 * "Watching" pill (with its microphone and remark bubbles) folded into the slim
 * edge tab, which still shows the live dot and the unread count. Their choice,
 * per token, until they expand it. A pill left over the text they are reading
 * was the complaint (owner, 2026-10-22): "it is kind of disturbing".
 */
const MIN_KEY = (token: string) => `fc-widget-min:${token.slice(0, 24)}`;

export function readMinimized(token: string): boolean {
  try {
    return localStorage.getItem(MIN_KEY(token)) === "1";
  } catch {
    return false;
  }
}

export function writeMinimized(token: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(MIN_KEY(token), "1");
    else localStorage.removeItem(MIN_KEY(token));
  } catch {
    /* storage unavailable — the choice just does not persist */
  }
}

/** Edge margin of a snapped launcher, in px. */
export const SNAP_MARGIN = 16;

/**
 * Snap a dropped launcher to the nearest left/right edge at the height it was
 * dropped. `rect` is the button where the pointer let go.
 */
export function snapToEdge(
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
): DragPosition {
  const side = rect.left + rect.width / 2 < viewport.width / 2 ? "left" : "right";
  const room = viewport.height - rect.height - 2 * SNAP_MARGIN;
  const y = room <= 0 ? 1 : (rect.top - SNAP_MARGIN) / room;
  return { side, y: Math.min(1, Math.max(0, y)) };
}

/** The top (px) of a launcher of `height` at drag position `pos`. */
export function dragTop(pos: DragPosition, height: number, viewportHeight: number): number {
  const room = Math.max(0, viewportHeight - height - 2 * SNAP_MARGIN);
  return Math.round(SNAP_MARGIN + pos.y * room);
}
