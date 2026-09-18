"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The body of a feedback report inside a list row: three lines, then "more".
 *
 * Reported through the widget on 2026-09-17: "one long report takes over the
 * whole inbox. The top item right now is eight lines of dictated text and it
 * pushes every other item below the fold, so the queue stops being scannable."
 * Dictated reports are long by nature, so the queue has to survive them — and
 * the full text has to stay reachable, which is why this expands in place
 * rather than truncating the string.
 *
 * The toggle appears ONLY when the text actually overflows, measured rather
 * than guessed from a character count: the same sentence wraps past three lines
 * on a phone and fits on a desktop, so a length heuristic would both hide the
 * toggle where it is needed and print "more" next to text that is all there.
 */
export function FeedbackReportText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement | null>(null);
  const bodyId = useId();

  const measure = useCallback(() => {
    const el = ref.current;
    // Only meaningful against the CLAMPED box. Expanded, nothing overflows by
    // definition, and re-measuring there would drop the toggle mid-read.
    if (!el || open) return;
    setOverflows(el.scrollHeight - el.clientHeight > 1);
  }, [open]);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Width drives wrapping, so a column that narrows (sidebar opens, phone
    // rotates) can push a fitting report over three lines after first paint.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, text]);

  return (
    <>
      {/* No `block` display utility on the clamped paragraph: a display utility
          silently defeats -webkit-line-clamp (same trap as .ui-loki-nudge-text
          in globals.css). */}
      <p
        ref={ref}
        id={bodyId}
        className={cn("min-w-0 text-sm leading-relaxed text-text-primary", !open && "line-clamp-3")}
      >
        {text}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="ui-link-subtle-button -ml-1"
        >
          {open ? "less" : "more"}
        </button>
      )}
    </>
  );
}
