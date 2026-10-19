"use client";

import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** One tappable row that is either chosen or not. Every choice in this sheet has
 *  the same shape on purpose — a phone sheet where each section invents its own
 *  control is how the old bar ended up five rows tall. */
export function OptionRow({
  title,
  detail,
  active,
  disabled,
  busy,
  onSelect,
}: {
  title: React.ReactNode;
  detail?: string;
  active: boolean;
  disabled?: boolean;
  busy?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      className={cn("ui-sheet-option", active && "ui-sheet-option-active")}
    >
      <span className="min-w-0 flex-1 text-left">
        <span className="ui-sheet-option-title">{title}</span>
        {detail && <span className="ui-sheet-option-detail">{detail}</span>}
      </span>
      {busy ? (
        <Loader2 className="ui-spinner-sm shrink-0" />
      ) : active ? (
        <Check className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
      ) : null}
    </button>
  );
}

export function SheetSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="ui-sheet-section">
      <h3 className="ui-sheet-label">{label}</h3>
      {children}
    </section>
  );
}
