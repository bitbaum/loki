"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useOverlayLock } from "@/hooks/use-overlay-lock";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

const SIZE_CLASSES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
} as const;

type Size = keyof typeof SIZE_CLASSES;

/** Centered modal dialog with backdrop + Esc-to-close. */
export function Modal({
  onClose,
  size = "md",
  padded = true,
  position = "center",
  disableClose = false,
  labelledBy,
  className,
  children,
}: {
  onClose: () => void;
  size?: Size;
  /** Apply default p-5 + space-y-4 panel padding. Disable for modals with custom internal layout. */
  padded?: boolean;
  /** "center" (default) or "bottom-mobile" — anchors to bottom on small screens, centered on md+. */
  position?: "center" | "bottom-mobile";
  /** When true, backdrop click and Esc are ignored (e.g. during async work). */
  disableClose?: boolean;
  /** Id of the dialog heading, when the caller supplies one. */
  labelledBy?: string;
  className?: string;
  children: React.ReactNode;
}) {
  useEscapeToClose(onClose, disableClose);
  const panelRef = useDialogFocus();
  useOverlayLock(true);
  const containerPos =
    position === "bottom-mobile" ? "items-end md:items-center" : "items-end md:items-center";
  const panelMargin =
    position === "bottom-mobile"
      ? "ui-modal-panel-mobile-bottom"
      : "ui-modal-panel-mobile-clearance";
  return (
    <div
      data-fc-place="hidden"
      className={cn("fixed inset-0 z-[60] flex justify-center p-4", containerPos)}
    >
      <div
        className="absolute inset-0 ui-backdrop-strong"
        onClick={disableClose ? undefined : onClose}
      />
      <div
        role="dialog"
        ref={panelRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "ui-modal-panel ui-card-shell-raised",
          SIZE_CLASSES[size],
          padded && "p-5 space-y-4",
          panelMargin,
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Right-anchored drawer with backdrop + Esc-to-close. */
export function Drawer({
  onClose,
  size = "lg",
  surface = "drawer",
  disableClose = false,
  className,
  children,
}: {
  onClose: () => void;
  size?: "md" | "lg" | "xl" | "2xl";
  /** "drawer", "modal", or "background" (page bg). */
  surface?: "drawer" | "modal" | "background";
  disableClose?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  useEscapeToClose(onClose, disableClose);
  const panelRef = useDialogFocus();
  useOverlayLock(true);
  // The opener often sits under this full-screen backdrop. Ignore the
  // leftover click from the same gesture so the drawer does not open+close.
  const [backdropArmed, setBackdropArmed] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setBackdropArmed(true), 250);
    return () => window.clearTimeout(id);
  }, []);
  const surfaceClass =
    surface === "drawer"
      ? "bg-surface-drawer"
      : surface === "modal"
        ? "bg-surface-modal"
        : "bg-surface-page";
  return (
    <div
      data-fc-place="hidden"
      className="fixed inset-0 z-[60] flex justify-end"
      role="presentation"
    >
      <div
        className="absolute inset-0 ui-backdrop"
        onClick={disableClose || !backdropArmed ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative flex h-full w-full max-w-full flex-col overflow-hidden sm:border-l border-border-subtle shadow-panel-strong",
          SIZE_CLASSES[size],
          surfaceClass,
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
