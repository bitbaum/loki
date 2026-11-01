"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StateLineTone } from "@/lib/workbench/state-line";

/**
 * The one frame both regions sit in — the site and the robot — and the
 * frame a solo window is. A window's anatomy: a title bar that says what
 * this is and how it is doing (a dot for its tone, one sentence, one link
 * on the right), over a body that takes the rest. The site's bar names
 * the page and what Loki is doing there; the robot's bar is the build's
 * state. Same bar, same radius, same border: two windows of one desk, not
 * a card beside a bare surface (one shape per kind, fleet AGENTS.md).
 */
export function WorkbenchFrame({
  label,
  tone = "neutral",
  title,
  aside,
  onClose,
  children,
}: {
  /** For a screen reader: "The site", "The robot". */
  label: string;
  tone?: StateLineTone;
  /** The bar's sentence. */
  title: React.ReactNode;
  /** The bar's one link, on the right. */
  aside?: React.ReactNode;
  /** A solo window: Close, which closes it. */
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="ui-workbench-frame" aria-label={label}>
      <header className="ui-workbench-frame-bar">
        <span className={cn("ui-dot shrink-0", `ui-dot-${tone}`)} aria-hidden="true" />
        <span className="ui-workbench-frame-title">{title}</span>
        {aside}
        {onClose && (
          <button
            type="button"
            className="ui-term-pane-btn"
            onClick={onClose}
            aria-label="Close this window"
            title="Close this window"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="ui-workbench-frame-body">{children}</div>
    </section>
  );
}
