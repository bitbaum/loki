/**
 * "Tap" on a touch screen, "click" with a mouse.
 *
 * Copy across Loki said "tap this" everywhere, written on a phone for a phone —
 * and read on a desktop it is wrong, and slightly odd, every time (operator,
 * 2026-10-12: "if it's a web version, it's not tapping, it's clicking"). The
 * rule for copy, in order of preference:
 *
 *   1. Say what happens, not the gesture: "Open the list", "Pick one",
 *      "Choose Send" read right on every device. Most copy should end here.
 *   2. Where the gesture IS the instruction ("tap the screen, then type"),
 *      use this — it follows the device actually in the person's hand.
 *
 * `(pointer: coarse)` is the primary input, not the screen size: a touch
 * laptop with a mouse attached says "click", a tablet says "tap". Server
 * rendering cannot know, so it says "click" — the client corrects it.
 */
export const TOUCH_POINTER_QUERY = "(pointer: coarse)";

export type PressVerb = { verb: "tap" | "click"; Verb: "Tap" | "Click" };

export function pressVerbFor(touch: boolean): PressVerb {
  return touch ? { verb: "tap", Verb: "Tap" } : { verb: "click", Verb: "Click" };
}
