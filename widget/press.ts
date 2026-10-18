/**
 * "Tap" on a touch screen, "click" with a mouse — for instructions that name
 * the gesture. This widget runs on other people's sites and is used from
 * phones and computers alike; "Tap ◎" read on a laptop is a small, constant
 * wrongness. Mirrors src/lib/pointer-verb (the widget cannot import from src/).
 *
 * Narration of what someone DID ("You pressed Save") uses "pressed", which is
 * true of both — that line is also read later, on whatever device.
 */
/** A touch screen (the primary pointer is a finger). */
export function coarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function pressVerb(): { verb: "tap" | "click"; Verb: "Tap" | "Click" } {
  return coarsePointer() ? { verb: "tap", Verb: "Tap" } : { verb: "click", Verb: "Click" };
}
