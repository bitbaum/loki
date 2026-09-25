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
 * - `free`: nothing of the host's that matters.
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
export const SLOT_VERDICTS = ["free", "surface", "layer", "blocked"] as const;
export type SlotVerdict = (typeof SLOT_VERDICTS)[number];

/** `data-fc-place` values a host can declare. */
export type PlaceDirective = "left" | "right" | "hidden";

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
  // Snapped to the climb grid, so the far band continues the near one exactly.
  const nearSteps = Math.floor(Math.min(NEAR_CLIMB, maxOffset - base.offsetY) / CLIMB_STEP);
  const nearTop = base.offsetY + nearSteps * CLIMB_STEP;
  const slots: Slot[] = [];
  for (const c of sides) slots.push(...climb(c, base.offsetY, nearTop));
  for (const c of sides) slots.push(...climb(c, nearTop + CLIMB_STEP, maxOffset));
  return slots;
}

/**
 * The first free slot; failing that the first of the least-bad kind
 * (surface, then layer); failing that null, which means "hide". Every slot
 * would sit on a host control, and a launcher that eats a click is worse than
 * no launcher — window.Loki.report() still works for a host that wires its
 * own button.
 *
 * `verdict` is the DOM measurement, injected so this stays pure. It runs
 * lazily and stops at the first free slot, so the common case — nothing in the
 * corner — costs one measurement.
 */
export function chooseSlot(
  slots: Slot[],
  verdict: (slot: Slot) => SlotVerdict,
): { slot: Slot; verdict: Exclude<SlotVerdict, "blocked"> } | null {
  const rank = (v: SlotVerdict) => SLOT_VERDICTS.indexOf(v);
  let best: { slot: Slot; verdict: Exclude<SlotVerdict, "blocked"> } | null = null;
  for (const slot of slots) {
    const v = verdict(slot);
    if (v === "free") return { slot, verdict: v };
    if (v !== "blocked" && (!best || rank(v) < rank(best.verdict))) best = { slot, verdict: v };
  }
  return best;
}

/**
 * Resolve `data-fc-place` declarations, given outermost (<html>) first and
 * then the page's regions in document order. The last valid one wins, so a
 * page region overrides a site-wide default on <html>. Unknown values are
 * ignored rather than guessed at.
 */
export function resolvePlaceDirective(
  values: Array<string | null | undefined>,
): PlaceDirective | null {
  let out: PlaceDirective | null = null;
  for (const raw of values) {
    const v = (raw ?? "").trim().toLowerCase();
    if (v === "left" || v === "right" || v === "hidden") out = v;
  }
  return out;
}
