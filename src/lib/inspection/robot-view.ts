/**
 * The geometry of watching Loki's browser: where its pointer goes on the
 * picture, and how far the view leans in so a desktop page stays readable
 * in a narrow column. Pure; tested in scripts/test/robot-view.ts.
 *
 * Coordinates arrive in the frame's own pixels (the viewport the worker
 * browsed at) and leave as percentages of the picture, so the overlay sits
 * on the same spot at any size the picture is drawn.
 */
export type RobotTarget = { x: number; y: number; width: number; height: number };
export type RobotFrameSize = { width: number; height: number };

export type Spot = {
  /** The pointer's tip: the centre of what is pressed. */
  x: number;
  y: number;
  /** The ring around what is pressed. */
  left: number;
  top: number;
  width: number;
  height: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pct = (n: number, of: number) => clamp((n / of) * 100, 0, 100);

/** Where to draw the pointer and ring, in percent of the picture; null when
 *  the frame only looks, or the target lies outside the picture. */
export function spotOf(frame: RobotFrameSize, target: RobotTarget | null | undefined): Spot | null {
  if (!target || frame.width <= 0 || frame.height <= 0) return null;
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  if (cx < 0 || cy < 0 || cx > frame.width || cy > frame.height) return null;
  return {
    x: pct(cx, frame.width),
    y: pct(cy, frame.height),
    left: pct(target.x, frame.width),
    top: pct(target.y, frame.height),
    width: clamp((target.width / frame.width) * 100, 0, 100),
    height: clamp((target.height / frame.height) * 100, 0, 100),
  };
}

/** No more than this: further in and the context around the press is gone. */
export const MAX_LEAN = 2.2;
/** At this share of its own width a page still reads; below it, lean in. */
const READABLE_SHARE = 0.55;

/**
 * How far to lean in, as a CSS scale. A phone-width page drawn at phone
 * width needs none; a 1440px desktop page in a 390px column is text no one
 * can read (the screenshot that started this, 2026-11-02), so the view
 * leans toward the press. Only when there is a press to lean toward: a
 * frame that only looks is shown whole.
 */
export function leanOf(frameWidth: number, drawnWidth: number, spot: Spot | null): number {
  if (!spot || frameWidth <= 0 || drawnWidth <= 0) return 1;
  const shrink = frameWidth / drawnWidth;
  return Math.round(clamp(shrink * READABLE_SHARE, 1, MAX_LEAN) * 100) / 100;
}

export type RobotView = {
  /** The height the picture's box takes (fit "width": the picture's own). */
  boxHeight: number;
  /** The picture, in px inside the box: its drawn size and where it sits. */
  layer: { width: number; height: number; x: number; y: number };
};

/**
 * Where the picture sits in its box, in px — one rule for both shapes:
 *
 * 1. Size it for the space. `fit: "width"` (a page that scrolls) fills the
 *    width and is as tall as it is. `fit: "contain"` (a box of fixed height,
 *    the workbench) never leaves a void: a picture wider than the box fills
 *    its HEIGHT and is cropped at the sides (a desktop page in a tall column
 *    stays readable); one narrower than the box fills the height and sits
 *    centred (a phone page, shown like a phone).
 * 2. Lean in if text would still be too small (leanOf), only toward a press.
 * 3. Slide so the press — or the page's centre — sits as near the middle as
 *    the picture's edges allow. Never past an edge: no empty band appears.
 */
export function viewOf(
  frame: RobotFrameSize,
  box: { width: number; height: number | null },
  spot: Spot | null,
): RobotView {
  const W = box.width;
  const ratio = frame.width / frame.height;
  let baseW: number;
  let baseH: number;
  if (box.height === null) {
    baseW = W;
    baseH = W / ratio;
  } else {
    baseH = box.height;
    baseW = baseH * ratio;
  }
  const boxHeight = box.height ?? baseH;
  // Readable or not is a matter of the size the page is DRAWN at, not the
  // window onto it: a desktop page filling a tall column is already legible.
  const lean = leanOf(frame.width, baseW, spot);
  const width = baseW * lean;
  const height = baseH * lean;
  const fx = ((spot?.x ?? 50) / 100) * width;
  const fy = ((spot?.y ?? 0) / 100) * height;
  const x = width > W ? clamp(W / 2 - fx, W - width, 0) : (W - width) / 2;
  const y = height > boxHeight ? clamp(boxHeight / 2 - fy, boxHeight - height, 0) : 0;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    boxHeight: r(boxHeight),
    layer: { width: r(width), height: r(height), x: r(x), y: r(y) },
  };
}

/** The ending, in the words a person would say. */
export function walkEnding(pages: number, findings: number): { title: string; detail: string } {
  const looked = pages === 1 ? "one page" : `${pages} pages`;
  if (findings === 0)
    return {
      title: "All done. It looks good.",
      detail: `Loki looked at ${looked} and found nothing to fix.`,
    };
  const found = findings === 1 ? "one thing worth fixing" : `${findings} things worth fixing`;
  return { title: "All done.", detail: `Loki looked at ${looked} and found ${found}.` };
}

/** Pages Loki actually opened, counted once each whatever the widths. */
export function pagesSeen(coverage: readonly { url: string; result: string }[]): number {
  return new Set(coverage.filter((c) => c.result === "visited").map((c) => c.url)).size;
}
