"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useMediaQuery } from "@/hooks/use-media-query";
import { NARROW_QUERY } from "@/hooks/use-is-narrow";
import { cn } from "@/lib/utils";

export type Choice<T extends string> = {
  value: T;
  label: string;
  /** One short line under the label, when the label alone is not enough. */
  hint?: string;
};

/**
 * "Sort: Priority ▾" — design reset rule 7, fit or menu
 * (docs/development/design-reset-2026-10.md).
 *
 * A row of choices either fits the phone (<Segmented>) or becomes this: ONE
 * button naming the current choice, which opens the options — as a bottom
 * sheet on a phone (the Modal's bottom-mobile position, the app's one sheet)
 * and as a small popover under the button from md up. Use it when the options
 * are more than three or their words are long; use Segmented when they fit.
 *
 *   <ChoiceMenu
 *     label="Sort"
 *     value={sort}
 *     options={[{ value: "priority", label: "Priority" }, { value: "recent", label: "Recent" }]}
 *     onChange={setSort}
 *   />
 */
export function ChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  align = "end",
  className,
}: {
  /** What is being chosen — "Sort", "Show". Shown before the value. */
  label: string;
  value: T;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
  /** Which edge of the button the popover (md up) lines up with. "end" —
   *  the default — for a menu at the right of a heading, so it opens inward. */
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const phone = useMediaQuery(NARROW_QUERY);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  // The popover (md up) closes on a click outside it and on Escape; the sheet
  // gets both from Modal.
  useEffect(() => {
    if (!open || phone) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, phone]);

  const choose = (next: T) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };

  const list = (
    <div role="listbox" aria-labelledby={titleId}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => choose(o.value)}
            className="ui-choice-option"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{o.label}</span>
              {o.hint && <span className="ui-choice-option-hint">{o.hint}</span>}
            </span>
            {selected && <Check className="h-4 w-4 shrink-0" aria-hidden />}
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={ref} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ui-choice-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{label}:</span>
        <span className="ui-choice-trigger-value">{current?.label}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
      </button>
      {open &&
        (phone ? (
          // To <body>: a sheet inside a hidden parent (the top bar hides
          // while a dialog is open) would vanish with it.
          createPortal(
            <Modal
              onClose={() => setOpen(false)}
              position="bottom-mobile"
              size="sm"
              padded={false}
              labelledBy={titleId}
              className="p-2"
            >
              <p id={titleId} className="ui-choice-sheet-title">
                {label}
              </p>
              {list}
            </Modal>,
            document.body,
          )
        ) : (
          <div className={cn("ui-choice-popover", align === "end" ? "right-0" : "left-0")}>
            <span id={titleId} className="sr-only">
              {label}
            </span>
            {list}
          </div>
        ))}
    </div>
  );
}
