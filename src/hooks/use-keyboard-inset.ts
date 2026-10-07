"use client";

import { useEffect, useState } from "react";

/**
 * How many pixels the soft keyboard is covering.
 *
 * On a phone the layout viewport does not shrink when the keyboard opens — the
 * page keeps its full height and the browser simply draws the keyboard over the
 * bottom of it. Anything anchored to the bottom of a `100svh` container is then
 * underneath the keys. That is the first screenshot in the report that started
 * this work: keyboard up, terminal squeezed into a ~150px strip, and the
 * controls that would have answered the on-screen prompt hidden below the
 * keyboard entirely.
 *
 * `visualViewport` is the part of the page the user can actually see, so the
 * difference between it and the window is exactly the covered height. Feeding
 * that back as padding keeps the key deck and composer sitting *on* the
 * keyboard, where a thumb already is.
 *
 * Returns 0 where `visualViewport` is unavailable (older browsers, SSR) — the
 * layout is then simply what it was before this hook existed, never broken.
 *
 * The measurement is from the window's bottom edge. While it is non-zero the
 * mobile nav hides itself and `.app-main` drops the padding it reserves for it
 * (`fc-keyboard-open`, set by MobileNav), so the fit is exact on every page —
 * the nav used to stay up and float over the composer being typed into.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () => {
      // offsetTop matters on iOS: the visual viewport scrolls up rather than
      // shrinking when a focused field would be covered, so the covered height
      // is what is left below its bottom edge, not just the height delta.
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Sub-pixel jitter and browser-chrome collapse both produce small
      // non-zero values with no keyboard present; treat only a real keyboard
      // (a large fraction of the screen) as an inset.
      setInset(covered > 120 ? Math.round(covered) : 0);
    };
    measure();
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    return () => {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, []);

  return inset;
}

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

/**
 * Whether the soft keyboard is up — for chrome that should step aside while it
 * is (the mobile tab bar), NOT for padding. Use `useKeyboardInset` for padding.
 *
 * `useKeyboardInset` alone cannot answer this on Android. The root layout sets
 * `interactive-widget=resizes-content`, which Chrome and Brave on Android honour:
 * the layout viewport shrinks with the keyboard, so `innerHeight` and
 * `visualViewport.height` fall together and the covered height is always 0.
 * That is correct for padding (nothing is covered) and wrong for "is the
 * keyboard open" — the tab bar stayed up and sat on top of the Terminal's
 * Prompt box, directly above the keys (reported from Brave on Android).
 *
 * So the second signal: a text field has focus AND the window is much shorter
 * than the tallest it has been at this width. Keyed by width so rotating the
 * phone is not mistaken for a keyboard.
 */
export function useKeyboardOpen(): boolean {
  const inset = useKeyboardInset();
  const [shrunk, setShrunk] = useState(false);

  useEffect(() => {
    const tallest = new Map<number, number>();
    const measure = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const editing = document.activeElement?.matches(EDITABLE) ?? false;
      const max = Math.max(tallest.get(w) ?? 0, h);
      // Only learn the full height while nothing is being typed into — a page
      // that loads with a field already focused must not take the shrunken
      // height as its baseline.
      if (!editing) tallest.set(w, max);
      setShrunk(editing && (tallest.get(w) ?? h) - h > 120);
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    document.addEventListener("focusin", measure);
    document.addEventListener("focusout", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      document.removeEventListener("focusin", measure);
      document.removeEventListener("focusout", measure);
    };
  }, []);

  return inset > 0 || shrunk;
}
