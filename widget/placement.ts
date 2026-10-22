/**
 * Where the launcher sits, and how it gets out of the way.
 *
 * Every mainstream chat widget parks itself bottom-right, and so did we — with
 * a z-index near the 32-bit maximum, which meant we usually won and covered
 * *their* button. This module is the answer to "get off my support widget".
 *
 * Kept separate from main.ts because the interesting parts (which corner, how
 * far to step aside, which slot wins) are pure and testable without a browser.
 * The DOM measurement lives in host-scan.ts and is injected as a verdict.
 */

export const CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"] as const;
export type Corner = (typeof CORNERS)[number];

export interface Placement {
  corner: Corner;
  offsetX: number;
  offsetY: number;
  autoAvoid: boolean;
}

export const DEFAULT_PLACEMENT: Placement = {
  corner: "bottom-right",
  offsetX: 16,
  offsetY: 16,
  autoAvoid: true,
};

/** Gap kept between our launcher and any host control or layer it steps
 *  around. Big enough that the two read as separate controls rather than one
 *  odd stack — and part of the measured rectangle, not added afterwards, so a
 *  slot flush against a button does not count as clear. */
export const AVOID_GAP = 12;

/** Distance between one candidate slot and the next along an edge. */
export const CLIMB_STEP = 16;

/** The "near" band of a corner. Every slot this close to the base offset — on
 *  BOTH sides — is tried before any slot further up an edge: a launcher in the
 *  opposite corner reads as placed, one halfway up the screen reads as lost. */
export const NEAR_CLIMB = 260;

/**
 * CSS edge properties for a corner. Returned rather than branched at the call
 * site so main.ts never re-derives which edges a corner implies — that was
 * where an earlier version put `bottom` on a top-anchored launcher.
 */
export function cornerEdges(corner: Corner): { x: "left" | "right"; y: "top" | "bottom" } {
  return {
    x: corner.endsWith("left") ? "left" : "right",
    y: corner.startsWith("top") ? "top" : "bottom",
  };
}

/** Coerce whatever boot returned into a usable placement. Total: a bad value
 *  must never stop the widget rendering. Mirrors normalizeWidgetPlacement in
 *  src/config/widget-placement.ts — the server's copy is authoritative, this
 *  one exists because the widget cannot import from src/. */
export function normalizePlacement(input: unknown): Placement {
  if (!input || typeof input !== "object") return { ...DEFAULT_PLACEMENT };
  const raw = input as Record<string, unknown>;
  const corner = (CORNERS as readonly string[]).includes(raw.corner as string)
    ? (raw.corner as Corner)
    : DEFAULT_PLACEMENT.corner;
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(240, Math.max(0, Math.round(n))) : fallback;
  };
  return {
    corner,
    offsetX: num(raw.offsetX, DEFAULT_PLACEMENT.offsetX),
    offsetY: num(raw.offsetY, DEFAULT_PLACEMENT.offsetY),
    autoAvoid: raw.autoAvoid === undefined ? true : Boolean(raw.autoAvoid),
  };
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Copy anything rect-shaped into a plain Rect.
 *
 * This exists because of a bug that unit tests could not see. `avoidOffsetY`
 * used to clone its input with `{...own}`, and `own` at runtime is a DOMRect
 * from getBoundingClientRect(). DOMRect exposes left/top/right/bottom as
 * GETTERS ON THE PROTOTYPE, not own enumerable properties — so the spread
 * produced `{}`, every comparison became `undefined < number` (false), and the
 * function concluded that nothing was ever in the way. Silently, with no error.
 *
 * The tests all passed because their fixtures were object literals, which
 * spread perfectly. Only a real browser reproduces it. Read the four fields
 * explicitly and the shape of the source stops mattering.
 */
export function toRect(r: Rect | DOMRect): Rect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** Do two rectangles overlap at all? Touching edges do not count. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** One place the launcher could sit: a corner plus its two edge offsets. */
export interface Slot {
  corner: Corner;
  offsetX: number;
  offsetY: number;
}

/**
 * What a slot would cover, best to worst.
 *
 * - `free`: nothing of the host's that matters — background, margin.
 * - `text`: in-flow words. Nothing to click, but the visitor is reading them,
 *   and a launcher parked on the middle of a line reads as broken. Loki's own
 *   sign-in page at 390px: every slot on the bottom band was a button, and the
 *   first "free" slot up the edge was the "or sign in" divider — the launcher
 *   sat on the words (2026-09-29). An empty slot is preferred; words are
 *   still better than any control.
 * - `surface`: part of a control far bigger than the launcher — a pannable
 *   map, a canvas, a card that is one big link. Every other part of it still
 *   works, so covering a corner costs the visitor almost nothing.
 * - `layer`: a host layer's content — a fixed/sticky bar, a bottom sheet, an
 *   inner scroll panel. What sits under us there is what the visitor is
 *   reading, and it scrolls small targets under us.
 * - `blocked`: an ordinary interactive element, or anything the host marked
 *   `data-fc-avoid`. Never acceptable: a launcher over a control steals its
 *   clicks (OrangeCat's Send button, 18 days).
 */
export const SLOT_VERDICTS = ["free", "text", "surface", "layer", "blocked"] as const;
export type SlotVerdict = (typeof SLOT_VERDICTS)[number];

/**
 * `data-fc-place` values a host can declare.
 *
 * - `left` / `right`: keep the launcher on that side.
 * - `tab`: this region is busy at its corners (a terminal, a full-width
 *   composer), so draw the launcher as the slim edge tab instead of the
 *   floating button. Still on screen, still one tap away.
 * - `hidden`: no launcher at all while the region is rendered. The host's
 *   off switch, for a checkout or a full-screen editor; the page should then
 *   offer its own control that calls `Loki.report()`.
 * - `host`: the host page draws the launcher itself — this region IS the
 *   launcher (Loki's own top bar: a round icon that calls `Loki.open()` and
 *   shows `Loki.status`). The floating button stays off while the region is
 *   rendered, and the owner's status counts as on screen, so watch mode does
 *   not add its own bar. When the region goes (an immersive page hides the
 *   top bar), the launcher comes back on its own.
 */
export type PlaceDirective = "left" | "right" | "tab" | "hidden" | "host";

/** Move a corner to the side a host or visitor asked for, keeping its edge. */
export function withSide(corner: Corner, side: "left" | "right"): Corner {
  return `${corner.startsWith("top") ? "top" : "bottom"}-${side}` as Corner;
}

/**
 * Every slot worth trying, best first.
 *
 * The order IS the preference, so the chooser can be a plain scan:
 *   1. the preferred corner, climbing its edge through the near band;
 *   2. the mirrored corner (same edge, other side), same band — unless the
 *      side is locked by a host directive or by the visitor's own choice;
 *   3. the rest of the preferred side's edge, then the mirrored side's.
 * Climbing stops where the launcher would leave the viewport.
 */
export function slotOrder(
  base: Slot,
  opts: { edgeLength: number; size: number; lockSide: boolean },
): Slot[] {
  const maxOffset = Math.max(base.offsetY, opts.edgeLength - opts.size - base.offsetY);
  const mirror = withSide(base.corner, base.corner.endsWith("left") ? "right" : "left");
  const sides: Corner[] = opts.lockSide ? [base.corner] : [base.corner, mirror];
  const climb = (corner: Corner, from: number, to: number): Slot[] => {
    const out: Slot[] = [];
    for (let o = from; o <= to; o += CLIMB_STEP) {
      out.push({ corner, offsetX: base.offsetX, offsetY: o });
    }
    return out;
  };
  const nearTop = nearBandTop(base, opts);
  const slots: Slot[] = [];
  for (const c of sides) slots.push(...climb(c, base.offsetY, nearTop));
  for (const c of sides) slots.push(...climb(c, nearTop + CLIMB_STEP, maxOffset));
  return slots;
}

/**
 * Where the near band ends: the highest offset still "in the corner".
 * Snapped to the climb grid, so the far band continues the near one exactly.
 */
export function nearBandTop(base: Slot, opts: { edgeLength: number; size: number }): number {
  const maxOffset = Math.max(base.offsetY, opts.edgeLength - opts.size - base.offsetY);
  const nearSteps = Math.floor(Math.min(NEAR_CLIMB, maxOffset - base.offsetY) / CLIMB_STEP);
  return base.offsetY + nearSteps * CLIMB_STEP;
}

/**
 * The first free slot; failing that the first of the least-bad kind
 * (surface, then layer); failing that null, which means "hide". Every slot
 * would sit on a host control, and a launcher that eats a click is worse than
 * no launcher — window.Loki.report() still works for a host that wires its
 * own button.
 *
 * ONE EXCEPTION, and it is about where a launcher belongs. A slot in the
 * near band that only covers plain text wins over a free slot halfway up the
 * page: a launcher over the last line of a paragraph in the corner is where
 * launchers live, a launcher floating mid-screen over a card title is a
 * stain (heidi.orangecat.ch, 2026-10-09: the site's own bottom bar took the
 * right corner, the left corner was body text, and the first free gap was
 * beside the heading). A layer or a surface in the near band still sends us
 * climbing — a bottom sheet scrolls small targets under us.
 *
 * `verdict` is the DOM measurement, injected so this stays pure. It runs
 * lazily and stops at the first free slot, so the common case — nothing in the
 * corner — costs one measurement.
 */
export function chooseSlot(
  slots: Slot[],
  verdict: (slot: Slot) => SlotVerdict,
  /** The top of the near band (nearBandTop); omitted = no band, old rule. */
  nearTop = -Infinity,
): { slot: Slot; verdict: Exclude<SlotVerdict, "blocked"> } | null {
  const rank = (v: SlotVerdict) => SLOT_VERDICTS.indexOf(v);
  let best: { slot: Slot; verdict: Exclude<SlotVerdict, "blocked"> } | null = null;
  let nearText: Slot | null = null;
  for (const slot of slots) {
    const near = slot.offsetY <= nearTop;
    if (!near && nearText) return { slot: nearText, verdict: "text" };
    const v = verdict(slot);
    if (v === "free") return { slot, verdict: v };
    if (v === "text" && near && !nearText) nearText = slot;
    if (v !== "blocked" && (!best || rank(v) < rank(best.verdict))) best = { slot, verdict: v };
  }
  return nearText ? { slot: nearText, verdict: "text" } : best;
}

/**
 * Resolve `data-fc-place` declarations, given outermost (<html>) first and
 * then the page's regions in document order. The last valid one wins, so a
 * page region overrides a site-wide default on <html> — except that a REGION
 * saying "hidden" (an open dialog) always wins: Loki's phone tab bar asks for
 * the tab on every page, and a dialog rendered earlier in the document must
 * still keep the launcher off itself. A rendered "host" (the page draws its
 * own launcher) outranks every position, since there is then nothing to
 * position; a hidden region still outranks it. Unknown values are ignored
 * rather than guessed at.
 */
export function resolvePlaceDirective(
  values: Array<string | null | undefined>,
): PlaceDirective | null {
  let out: PlaceDirective | null = null;
  let regionHidden = false;
  let host = false;
  values.forEach((raw, i) => {
    const v = (raw ?? "").trim().toLowerCase();
    if (v === "left" || v === "right" || v === "tab" || v === "hidden") out = v;
    if (v === "hidden" && i > 0) regionHidden = true;
    if (v === "host") host = true;
  });
  return regionHidden ? "hidden" : host ? "host" : out;
}

/**
 * Where on its side edge the tab sits: the first height (as a fraction of the
 * viewport) whose verdict is not `blocked`, trying the middle first and then
 * stepping outward, so it lands in the same place on every page that allows
 * it. If every height is blocked it stays in the middle: the tab is the shape
 * the launcher takes precisely so it is never missing, and it is narrow enough
 * to cover only the outermost sliver of whatever is under it.
 */
export const TAB_HEIGHTS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74] as const;

export function chooseTabTop(
  viewportHeight: number,
  tabHeight: number,
  verdict: (top: number) => SlotVerdict,
  /** A height (px) the person already chose: tried before the standard ones, so
   *  a minimized launcher folds into the edge where they left it. */
  preferredTop?: number,
): number {
  const topAt = (f: number) => Math.round(viewportHeight * f - tabHeight / 2);
  if (
    preferredTop !== undefined &&
    preferredTop >= 0 &&
    preferredTop + tabHeight <= viewportHeight &&
    verdict(preferredTop) !== "blocked"
  ) {
    return preferredTop;
  }
  for (const f of TAB_HEIGHTS) {
    const top = topAt(f);
    if (verdict(top) !== "blocked") return top;
  }
  return topAt(TAB_HEIGHTS[0]);
}

/**
 * A corner that already holds the host's own floating button — its Ask, its
 * chat bubble — belongs to the host. Climbing that edge stacked two
 * assistants into one tower: on substrata at 390px the launcher sat 12px above
 * the site's ASK, and at 1280px it floated 300px up the edge (2026-10-17). So
 * the launcher yields: the other corner if that is clear, else the edge tab.
 *
 * A floating button, as opposed to a bar: compact, and hugging the side edge
 * it shares with us. A tab bar or a composer spans the width, and its controls
 * are stepped around as before.
 */
export const FLOAT_MAX_WIDTH = 0.75;
export const FLOAT_MAX_HEIGHT = 0.25;
export const FLOAT_EDGE = 96;

export function isCornerFloat(
  box: Rect,
  side: "left" | "right",
  viewport: { width: number; height: number },
): boolean {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  if (w <= 0 || h <= 0) return false;
  if (w > viewport.width * FLOAT_MAX_WIDTH || h > viewport.height * FLOAT_MAX_HEIGHT) return false;
  const gap = side === "right" ? viewport.width - box.right : box.left;
  return gap >= 0 && gap <= FLOAT_EDGE;
}

/**
 * The stretch of edge a corner's launcher would climb through its near band
 * (plus the avoid gap): where a host's floating button would end up stacked
 * against ours. In viewport coordinates.
 */
export function cornerColumn(
  slot: Slot,
  size: { width: number; height: number },
  nearTop: number,
  viewport: { width: number; height: number },
): Rect {
  const { x, y } = cornerEdges(slot.corner);
  const left = x === "left" ? slot.offsetX : viewport.width - slot.offsetX - size.width;
  const reach = nearTop + size.height + AVOID_GAP;
  return {
    left: left - AVOID_GAP,
    right: left + size.width + AVOID_GAP,
    top: y === "top" ? 0 : Math.max(0, viewport.height - reach),
    bottom: y === "top" ? Math.min(viewport.height, reach) : viewport.height,
  };
}

/**
 * Which corner to start from once the host's floating buttons are known:
 * the configured one when it is ours, the mirrored one when only ours is
 * taken, and "tab" when both are. `locked` (a side the host or the visitor
 * named) is never overridden — they chose it knowing what is there.
 */
export function yieldCorner(
  corner: Corner,
  taken: (c: Corner) => boolean,
  locked: boolean,
): { corner: Corner; yielded: boolean } | "tab" {
  if (locked || !taken(corner)) return { corner, yielded: false };
  const mirror = withSide(corner, corner.endsWith("left") ? "right" : "left");
  return taken(mirror) ? "tab" : { corner: mirror, yielded: true };
}
