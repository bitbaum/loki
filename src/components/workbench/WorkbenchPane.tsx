"use client";

import { AppWindow, X } from "lucide-react";
import { WORKBENCH_PANES, type WorkbenchPaneId } from "@/config/workbench";

/**
 * The frame every pane sits in: one header row — the pane's name, then
 * "in its own window" and close — over a body that takes the rest. The
 * controls are the terminal's own pane buttons (`ui-term-pane-btn`), so
 * a pane looks the same here as the terminal's rail does there.
 *
 * In a solo window (`?pane=`) the header offers Close, which closes the
 * window the way the person opened it: the pane IS the window.
 */
export function WorkbenchPane({
  pane,
  solo,
  onPopOut,
  onClose,
  children,
}: {
  pane: WorkbenchPaneId;
  solo: boolean;
  onPopOut?: () => void;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const meta = WORKBENCH_PANES[pane];
  const Icon = meta.icon;
  return (
    <section className="ui-workbench-pane" aria-label={meta.label}>
      <header className="ui-workbench-pane-head">
        <Icon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
        <h2 className="ui-workbench-pane-title">{meta.label}</h2>
        <span className="flex-1" />
        {!solo && onPopOut && (
          <button
            type="button"
            className="ui-term-pane-btn"
            onClick={onPopOut}
            aria-label={`${meta.label} in its own window`}
            title="In its own window"
          >
            <AppWindow className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        {onClose && (
          <button
            type="button"
            className="ui-term-pane-btn"
            onClick={onClose}
            aria-label={solo ? "Close this window" : `Close ${meta.label}`}
            title={solo ? "Close this window" : "Close"}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="ui-workbench-pane-body">{children}</div>
    </section>
  );
}
