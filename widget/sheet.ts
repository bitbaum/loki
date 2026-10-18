/**
 * The panel as a phone sheet you can size with your thumb: drag its top edge
 * up for the whole screen, down for a peek, further down to put it away.
 * Desktop keeps the corner card — there the page is beside it, not under it.
 *
 * Pure decision (sheetSnap) is tested in scripts/test/widget-sheet.ts.
 */
import { h } from "./dom";

export type SheetSize = "peek" | "auto" | "full";

/** Where a drag of `dy` px (down is positive) from `from` should settle. */
export function sheetSnap(from: SheetSize, dy: number): SheetSize | "close" {
  const order: SheetSize[] = ["peek", "auto", "full"];
  if (dy > 160 && from !== "full") return "close";
  if (dy > 160) return "peek";
  if (Math.abs(dy) < 40) return from;
  const i = order.indexOf(from) + (dy < 0 ? 1 : -1);
  if (i < 0) return "close";
  return order[Math.min(i, order.length - 1)];
}

/**
 * How much of the bottom of the screen the on-screen keyboard covers, in px.
 *
 * Android Chrome (by default, and on every host page that does not opt into
 * `interactive-widget=resizes-content`) lays the keyboard OVER the page: the
 * layout viewport keeps its height, so a sheet pinned to `bottom: 0` with a
 * `vh` height has its lower part — the composer's Send buttons — under the
 * keys. The visual viewport is what is actually visible. Under 80px is a
 * browser toolbar settling, not a keyboard.
 */
export function keyboardInset(innerHeight: number, vvHeight: number, vvOffsetTop: number): number {
  const covered = Math.round(innerHeight - vvHeight - vvOffsetTop);
  return covered >= 80 ? covered : 0;
}

const HEIGHT: Record<SheetSize, string> = {
  peek: "42vh",
  auto: "",
  full: "calc(100vh - 16px)",
};

export function attachSheet(opts: {
  panel: HTMLElement;
  /** The header — dragging it moves the sheet; its buttons still work. */
  handle: HTMLElement;
  onClose: () => void;
}): { reset: () => void } {
  const { panel, handle } = opts;
  const grip = h("div", "grip");
  grip.setAttribute("aria-hidden", "true");
  panel.prepend(grip);
  let size: SheetSize = "auto";
  const phone = () => window.matchMedia("(max-width: 480px)").matches;
  /** Keyboard up: the sheet stands on it and fits what is still visible. */
  let kb = 0;
  /**
   * Typing in the panel. A page with `interactive-widget=resizes-content`
   * (Loki's own) SHRINKS for the keyboard instead of laying it over, so
   * keyboardInset reads 0 and the sheet stayed at 68% of a viewport already
   * halved: the thread became a one-pixel sliver under three rows of extras
   * (owner's phone, 2026-10-18). A focused text box on a phone is the same
   * moment whichever way the browser draws the keyboard.
   */
  let typing = false;
  /** The tallest the visible area has been: a page that shrinks for the
   *  keyboard shows it only as being much shorter than that. */
  let tallest = 0;
  const visible = () => window.visualViewport?.height ?? window.innerHeight;
  /** Typing AND the keyboard is up. Android's back key drops the keyboard
   *  but keeps focus in the box, and then the extras come back. */
  const squeezed = () => {
    tallest = Math.max(tallest, visible());
    return typing && visible() < tallest * 0.8;
  };
  const apply = () => {
    if (!kb && squeezed() && phone()) {
      panel.style.bottom = "";
      panel.style.height = "";
      panel.style.maxHeight = `${Math.max(160, (window.visualViewport?.height ?? window.innerHeight) - 8)}px`;
    } else if (kb && phone()) {
      const room = `${Math.max(160, (window.visualViewport?.height ?? window.innerHeight) - 8)}px`;
      panel.style.bottom = `${kb}px`;
      panel.style.height = size === "full" ? room : "";
      panel.style.maxHeight = room;
    } else {
      panel.style.bottom = "";
      panel.style.height = HEIGHT[size];
      panel.style.maxHeight = size === "full" ? "none" : "";
    }
    // While typing, the extras step aside for the conversation (theme.ts .kb).
    panel.classList.toggle("kb", (kb > 0 || squeezed()) && phone());
  };
  const isTextBox = (el: EventTarget | null) =>
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !["button", "checkbox", "radio", "file"].includes(el.type));
  panel.addEventListener("focusin", (e) => {
    if (!isTextBox(e.target) || typing) return;
    typing = true;
    apply();
  });
  panel.addEventListener("focusout", (e) => {
    // Moving from the box to a button in the panel (Send, Talk) keeps the
    // layout still: a sheet that resized between a press and its click would
    // move Send out from under the thumb. Only leaving the panel ends it.
    const to = e.relatedTarget;
    if (!isTextBox(e.target) || (to instanceof Node && panel.contains(to))) return;
    typing = false;
    apply();
  });
  const vv = window.visualViewport;
  const onViewport = () => {
    if (!vv) return;
    if (!typing) tallest = Math.max(tallest, vv.height);
    const next = keyboardInset(window.innerHeight, vv.height, vv.offsetTop);
    // While typing on a page that shrinks for the keyboard, the room to fill
    // changes with every resize even though no inset ever appears.
    if (next === kb && !typing) return;
    kb = next;
    apply();
  };
  vv?.addEventListener("resize", onViewport);
  vv?.addEventListener("scroll", onViewport);

  let startY: number | null = null;
  let dy = 0;
  const down = (e: PointerEvent) => {
    if (!phone() || (e.target as Element).closest("button,a,input,textarea")) return;
    startY = e.clientY;
    dy = 0;
    panel.style.transition = "none";
  };
  const move = (e: PointerEvent) => {
    if (startY === null) return;
    dy = e.clientY - startY;
    // Follow the thumb downward; upward is a resize, shown on release.
    panel.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  };
  const up = () => {
    if (startY === null) return;
    startY = null;
    panel.style.transition = "";
    panel.style.transform = "";
    const next = sheetSnap(size, dy);
    if (next === "close") {
      size = "auto";
      apply();
      opts.onClose();
      return;
    }
    size = next;
    apply();
  };
  for (const el of [grip, handle]) el.addEventListener("pointerdown", down);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);

  return {
    reset() {
      size = "auto";
      typing = false;
      apply();
    },
  };
}
