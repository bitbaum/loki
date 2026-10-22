"use client";

import { useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

/**
 * One thing, opened from its row: a bottom sheet on a phone, a centred dialog
 * from md up (Modal's `bottom-mobile`, the app's one sheet). Design reset
 * rule 3 — a list is rows, and what used to sit in a row as four buttons and
 * an inline form lives here instead, one tap away.
 *
 *   {open && (
 *     <DetailSheet title={sub.name} subtitle="12.00 CHF a month" onClose={close}>
 *       <SheetActions>
 *         <SheetAction icon={Check} onClick={markPaid}>Mark paid</SheetAction>
 *       </SheetActions>
 *     </DetailSheet>
 *   )}
 *
 * It portals to <body>: a row's sheet opened from inside a list (or the top
 * bar, which hides while a dialog is open) must not vanish with its parent.
 */
export function DetailSheet({
  title,
  subtitle,
  onClose,
  size = "md",
  children,
}: {
  title: string;
  /** One grey line under the title — the fact the row's trailing slot showed. */
  subtitle?: React.ReactNode;
  onClose: () => void;
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}) {
  const titleId = useId();
  return createPortal(
    <Modal
      onClose={onClose}
      position="bottom-mobile"
      size={size}
      padded={false}
      labelledBy={titleId}
    >
      <div className="ui-detail-sheet-head">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="ui-detail-sheet-title">
            {title}
          </h2>
          {subtitle && <div className="ui-detail-sheet-sub">{subtitle}</div>}
        </div>
        <button type="button" onClick={onClose} className="ui-btn-icon" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="ui-detail-sheet-body">{children}</div>
    </Modal>,
    document.body,
  );
}

/** The sheet's actions: full-width rows, icon and verb, one per line. */
export function SheetActions({ children }: { children: React.ReactNode }) {
  return <div className="ui-detail-sheet-actions">{children}</div>;
}

/** The class an action row uses — for components that take a className
 *  (LokiDispatchButton, DeleteButton) instead of being a SheetAction. */
export const SHEET_ACTION = "ui-detail-sheet-action";
export const SHEET_ACTION_DANGER = "ui-detail-sheet-action ui-detail-sheet-action-danger";

export function SheetAction({
  icon: Icon,
  onClick,
  href,
  disabled,
  danger,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  /** An outside link (opens in a new tab). */
  href?: string;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const cls = cn(SHEET_ACTION, danger && "ui-detail-sheet-action-danger");
  const inner = (
    <>
      {Icon && <Icon className="h-5 w-5 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </>
  );
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    );
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {inner}
    </button>
  );
}
