"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SLOT_ID = "ui-app-topbar-slot";
const ACTION_SLOT_ID = "ui-app-topbar-action";

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
  const slot = useSlot(SLOT_ID);
  return slot ? createPortal(children, slot) : null;
}

/**
 * The place on the RIGHT of the phone top bar, just before the avatar, where
 * a page's one primary action goes (PageAction, design reset rule 5) — where
 * Claude puts "new chat". Empty (and so not drawn) on pages without one.
 */
export function TopbarActionSlot() {
  return <div id={ACTION_SLOT_ID} className="ui-app-topbar-action" />;
}

/** The action slot, or null outside the app shell / before hydration. */
export function useTopbarActionSlot(): HTMLElement | null {
  return useSlot(ACTION_SLOT_ID);
}

// The slots are static shell markup, so there is nothing to subscribe to: the
// server snapshot is null (no portal in SSR), and after hydration React
// re-reads the client snapshot and finds the element.
function useSlot(id: string): HTMLElement | null {
  return useSyncExternalStore(
    noSubscribe,
    () => document.getElementById(id),
    () => null,
  );
}

const noSubscribe = () => () => {};
