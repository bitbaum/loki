"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query, for the rare decision CSS cannot make — e.g. whether a toggle
 * is pressed depends on whether the thing it toggles can be on screen at all.
 *
 * Hydration-safe on purpose, unlike useIsNarrow: the server has no viewport,
 * so it renders `false`, and React swaps in the real answer right after
 * hydration. Reading `matchMedia` in a state initialiser instead made the
 * server and client disagree about the terminal's Loki rail on every wide
 * screen ("Hydration failed…", measured 2026-09-24).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
