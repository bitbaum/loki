"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SLOT_ID = "ui-app-topbar-slot";

/**
 * A place on the LEFT of the app top bar, phones only, that a page can lend its
 * own one or two controls to.
 *
 * On a phone the top bar's left half is empty on the bottom-tab pages (it shows
 * no title there — see AppTopBar), while pages like Loki chat drew a SECOND bar
 * of their own directly beneath it for two icons. Two stacked headers cost a
 * 6" screen ~60px of conversation for nothing. The page keeps owning its
 * controls; they simply render up here.
 */
export function TopbarSlot() {
  return <div id={SLOT_ID} className="flex items-center gap-0.5 md:hidden" />;
}

/** Render `children` into the top bar's slot (phones). Renders nothing until
 *  the slot exists, so a page outside the app shell is unaffected. */
export function TopbarPortal({ children }: { children: ReactNode }) {
  // The slot is static shell markup, so there is nothing to subscribe to: the
  // server snapshot is null (no portal in SSR), and after hydration React
  // re-reads the client snapshot and finds the element.
  const slot = useSyncExternalStore(
    noSubscribe,
    () => document.getElementById(SLOT_ID),
    () => null,
  );
  return slot ? createPortal(children, slot) : null;
}

const noSubscribe = () => () => {};
