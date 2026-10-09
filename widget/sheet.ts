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
  const apply = () => {
    panel.style.height = HEIGHT[size];
    panel.style.maxHeight = size === "full" ? "none" : "";
  };

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
      apply();
    },
  };
}
