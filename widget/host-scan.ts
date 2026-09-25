/**
 * What the launcher would cover if it sat here — measured on the host page.
 *
 * The one DOM-touching half of placement (placement.ts is the pure half). It
 * answers a single question per candidate rectangle: free, surface, layer or
 * blocked (see SlotVerdict). Earlier versions answered narrower questions and each
 * missed a real page:
 *
 *   - a rectangle scan of fixed elements, which skipped anything wider than
 *     90% of the viewport — every bottom sheet, tab bar and cookie bar;
 *   - a hit-test for a short list of tags, which could not see a host layer
 *     (substrata's country sheet) or a clickable div.
 *
 * Here the launcher asks the browser what a click at each point would reach
 * if we were not there — `elementsFromPoint`, minus our own host — and walks
 * that element's ancestors once. Only what a visitor could actually touch or
 * read under us counts, and elements hidden under an opaque host layer do not.
 *
 * The host can say what heuristics cannot see (the host contract):
 *   data-fc-avoid                   never overlap this element
 *   data-fc-place="left|right|hidden" on <html> or a page region
 */
import { AVOID_GAP, overlaps, resolvePlaceDirective, SLOT_VERDICTS, toRect } from "./placement";
import type { PlaceDirective, Rect, SlotVerdict } from "./placement";

/** Things a click or tap on reaches. `iframe` because an embed (a map, a
 *  vendor chat) is somebody's UI even though we cannot look inside it. */
const INTERACTIVE = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "label",
  "iframe",
  "video[controls]",
  "audio[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='slider']",
  "[role='option']",
  "[role='combobox']",
  "[role='textbox']",
].join(",");

/** A fixed/scrolling layer this large is the page itself — an app shell, a
 *  full-screen map, a modal backdrop — not a thing to step around. Its
 *  controls are still found by the interactive test. */
const BACKDROP_AREA = 0.6;

/** A control covering this much of the viewport is a surface (a map, a
 *  canvas, a card-sized link): the launcher over its corner leaves the rest of
 *  it working. substrata's pannable world map is the case — without this,
 *  the only slots left on /atlas at 390px were on the country sheet. */
const SURFACE_AREA = 0.25;

/** Sample grid per axis. Over a 58-72px probe (launcher plus gap) this spaces
 *  points ~20-24px apart, so no control of the 24px minimum target size can
 *  sit between them. */
const GRID = 4;

/** Index into SLOT_VERDICTS: 0 free, 1 surface, 2 layer, 3 blocked. */
type Weight = 0 | 1 | 2 | 3;

interface HostScanner {
  /** Verdict for the launcher occupying `rect` (viewport coordinates). */
  verdict(rect: Rect | DOMRect): SlotVerdict;
}

export function createHostScanner(ownHost: Element): HostScanner {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const viewportArea = Math.max(1, vw * vh);
  // Per-run caches: a scan walks the same ancestors for dozens of points.
  const layerCache = new Map<Element, Weight>();
  const avoidRects = Array.from(document.querySelectorAll("[data-fc-avoid]"))
    .filter((el) => el !== ownHost && !ownHost.contains(el))
    .map((el) => toRect(el.getBoundingClientRect()))
    .filter((r) => r.right > r.left && r.bottom > r.top);

  /** Is this one element (not its ancestors) a host layer we should not sit on? */
  function layerWeight(el: Element): Weight {
    const hit = layerCache.get(el);
    if (hit !== undefined) return hit;
    let w: Weight = 0;
    if (el !== document.documentElement && el !== document.body) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const small = (r.width * r.height) / viewportArea < BACKDROP_AREA;
      const positioned = cs.position === "fixed" || cs.position === "sticky";
      // An inner scroll panel (bottom sheet, chat log, side drawer): what sits
      // under us changes as the visitor scrolls it, so there is no position
      // over it that stays clear of its content.
      const scrolls =
        (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight + 1;
      if (small && (positioned || scrolls)) w = 2;
    }
    layerCache.set(el, w);
    return w;
  }

  const isSurface = (el: Element) => {
    const r = el.getBoundingClientRect();
    return (r.width * r.height) / viewportArea >= SURFACE_AREA;
  };

  /** The element a pointer cursor comes from: cursor inherits, so climb to
   *  the outermost ancestor still showing it. */
  function pointerOrigin(el: Element): Element {
    let origin = el;
    for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
      if (getComputedStyle(up).cursor !== "pointer") break;
      origin = up;
    }
    return origin;
  }

  function weightAt(x: number, y: number): Weight {
    // What would receive a click here if the launcher were not on top.
    const under = document
      .elementsFromPoint(x, y)
      .find((el) => el !== ownHost && !ownHost.contains(el));
    if (!under) return 0;
    if (under.closest("[data-fc-avoid]")) return 3;
    let w: Weight = 0;
    let control = under.closest(INTERACTIVE);
    // A clickable div announces itself only through its cursor.
    if (!control) {
      try {
        if (getComputedStyle(under).cursor === "pointer") control = pointerOrigin(under);
      } catch {
        /* detached mid-scan — treat as nothing */
      }
    }
    if (control) {
      if (!isSurface(control)) return 3;
      w = 1;
    }
    for (let el: Element | null = under; el && w < 2; el = el.parentElement) {
      if (layerWeight(el) === 2) w = 2;
    }
    return w;
  }

  return {
    verdict(input) {
      const r = toRect(input);
      const probe: Rect = {
        left: r.left - AVOID_GAP,
        right: r.right + AVOID_GAP,
        top: r.top - AVOID_GAP,
        bottom: r.bottom + AVOID_GAP,
      };
      // Declared avoid regions by rectangle too: elementsFromPoint skips
      // pointer-events:none, and a host may mark exactly such an overlay.
      if (avoidRects.some((a) => overlaps(probe, a))) return "blocked";
      let worst = 0;
      for (let i = 0; i < GRID; i++) {
        for (let j = 0; j < GRID; j++) {
          const x = probe.left + ((probe.right - probe.left) * (i + 0.5)) / GRID;
          const y = probe.top + ((probe.bottom - probe.top) * (j + 0.5)) / GRID;
          if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
          const w = weightAt(x, y);
          if (w === 3) return "blocked";
          if (w > worst) worst = w;
        }
      }
      return SLOT_VERDICTS[worst];
    },
  };
}

/**
 * The page's `data-fc-place` directive: <html> first, then every rendered
 * region carrying the attribute in document order — the last one wins, so a
 * route's own region overrides the site-wide default. A region that is not
 * rendered (display:none, unmounted) says nothing.
 */
export function readPlaceDirective(): PlaceDirective | null {
  const values: Array<string | null> = [document.documentElement.getAttribute("data-fc-place")];
  for (const el of Array.from(document.querySelectorAll("body [data-fc-place]"))) {
    if (el.getClientRects().length > 0) values.push(el.getAttribute("data-fc-place"));
  }
  return resolvePlaceDirective(values);
}
