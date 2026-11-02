"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * The browser's own full screen, on one element: the workbench root. Esc
 * leaves it, the way every full-screen video does, and the desktop app's
 * View → Toggle Full Screen is the same thing one level up.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  // Read after hydration: the server has no document, and a lazy initializer
  // is locked into the RSC payload (use-inside-fleet-runner.ts says why).
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only capability, read once
    setSupported("requestFullscreen" in document.documentElement);
    const sync = () => setActive(document.fullscreenElement === ref.current && !!ref.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [ref]);
  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen().catch(() => undefined);
  }, [ref]);
  return { active, toggle, supported };
}
