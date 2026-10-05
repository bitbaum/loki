/**
 * Finger scrolling for the terminal.
 *
 * xterm 6 scrolls with VS Code's scrollable element, which listens for the
 * WHEEL and nothing else: on a phone a swipe over the terminal moved nothing,
 * so the operator could watch an agent work but never read what it wrote a
 * screen ago ("I can look at it, but I cannot scroll it", 2026-10-05). This
 * module turns a vertical swipe into `scrollLines`, carries the fractional
 * remainder so a slow drag is as exact as a fast one, and keeps gliding after
 * a flick the way every other scrolling surface on the phone does.
 *
 * The arithmetic is pure and tested (scripts/test/terminal-touch-scroll.ts);
 * the listener is a thin adapter around it.
 */

/** Pixels a finger must travel before a touch counts as a scroll and not a
 *  tap — taps still focus the terminal and open links. */
export const TOUCH_SCROLL_SLOP_PX = 8;
/** Per-frame velocity decay after a flick (at 60 fps). */
export const TOUCH_SCROLL_FRICTION = 0.94;
/** Below this speed (px/ms) the glide stops. */
export const TOUCH_SCROLL_MIN_VELOCITY = 0.02;

/**
 * Whole lines to scroll for a finger movement of `deltaPx`, given `carryPx`
 * left over from before. A finger moving UP (negative delta) reveals later
 * output, so it scrolls DOWN (positive lines) — content follows the finger.
 */
export function linesForDrag(
  deltaPx: number,
  carryPx: number,
  cellHeightPx: number,
): { lines: number; carryPx: number } {
  if (!(cellHeightPx > 0)) return { lines: 0, carryPx: 0 };
  const total = carryPx - deltaPx;
  const lines = Math.trunc(total / cellHeightPx);
  return { lines, carryPx: total - lines * cellHeightPx };
}

/** Next glide velocity, or 0 once it is too slow to see. `dtMs` lets a slow
 *  frame decay as much as the frames it stands in for. */
export function decayVelocity(velocity: number, dtMs: number): number {
  const next = velocity * Math.pow(TOUCH_SCROLL_FRICTION, dtMs / (1000 / 60));
  return Math.abs(next) < TOUCH_SCROLL_MIN_VELOCITY ? 0 : next;
}

export type TouchScrollTarget = {
  scrollLines: (amount: number) => void;
  /** Current cell height in CSS pixels (rows change with the font stepper). */
  cellHeight: () => number;
};

/**
 * Attach finger scrolling to `host`. Returns the detach function.
 *
 * Listeners are non-passive only so a swipe that IS a scroll can stop the page
 * from scrolling underneath it; a touch that never passes the slop is left
 * entirely to the browser and to xterm (tap to focus, tap a link).
 */
export function attachTouchScroll(host: HTMLElement, target: TouchScrollTarget): () => void {
  let lastY = 0;
  let startY = 0;
  let lastT = 0;
  let scrolling = false;
  let carry = 0;
  let velocity = 0; // px per ms, finger direction
  let frame = 0;

  const stopGlide = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const apply = (deltaPx: number) => {
    const step = linesForDrag(deltaPx, carry, target.cellHeight());
    carry = step.carryPx;
    if (step.lines !== 0) target.scrollLines(step.lines);
  };

  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    stopGlide();
    startY = lastY = e.touches[0]!.clientY;
    lastT = e.timeStamp;
    scrolling = false;
    carry = 0;
    velocity = 0;
  };

  const onMove = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const y = e.touches[0]!.clientY;
    if (!scrolling && Math.abs(y - startY) < TOUCH_SCROLL_SLOP_PX) return;
    scrolling = true;
    e.preventDefault();
    const dy = y - lastY;
    const dt = Math.max(1, e.timeStamp - lastT);
    // Smoothed, so one jittery sample does not decide the flick.
    velocity = 0.8 * (dy / dt) + 0.2 * velocity;
    lastY = y;
    lastT = e.timeStamp;
    apply(dy);
  };

  const onEnd = () => {
    if (!scrolling) return;
    scrolling = false;
    let prev = performance.now();
    const glide = (now: number) => {
      const dt = now - prev;
      prev = now;
      velocity = decayVelocity(velocity, dt);
      if (velocity === 0) {
        frame = 0;
        return;
      }
      apply(velocity * dt);
      frame = requestAnimationFrame(glide);
    };
    if (Math.abs(velocity) >= TOUCH_SCROLL_MIN_VELOCITY) frame = requestAnimationFrame(glide);
  };

  host.addEventListener("touchstart", onStart, { passive: true });
  host.addEventListener("touchmove", onMove, { passive: false });
  host.addEventListener("touchend", onEnd, { passive: true });
  host.addEventListener("touchcancel", onEnd, { passive: true });
  return () => {
    stopGlide();
    host.removeEventListener("touchstart", onStart);
    host.removeEventListener("touchmove", onMove);
    host.removeEventListener("touchend", onEnd);
    host.removeEventListener("touchcancel", onEnd);
  };
}
