"use client";

import { useCallback, type HTMLAttributes, type RefObject } from "react";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

/**
 * A panel that owns the keyboard while it is open: focus moves in when it
 * mounts, Tab stays inside, and focus goes back to what opened it on unmount
 * (hooks/use-dialog-focus). Mount it only while the overlay is open.
 *
 * For overlays that are drawn by a component which itself stays mounted (the
 * Sessions drawer, the command palette): the hook runs once per mount, so it
 * has to live in something that mounts with the panel.
 */
export function DialogFocus({
  panelRef,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  /** Also hand the element to the caller (an outside-click test, a measure). */
  panelRef?: RefObject<HTMLDivElement | null>;
}) {
  const focusRef = useDialogFocus();
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      focusRef.current = el;
      if (panelRef) panelRef.current = el;
    },
    [focusRef, panelRef],
  );
  return <div ref={setRef} tabIndex={-1} {...props} />;
}
