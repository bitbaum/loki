"use client";

import { X } from "lucide-react";
import { WORKBENCH_PANES, type WorkbenchPaneId } from "@/config/workbench";

/**
 * A window that is ONE pane (`?pane=`): the pane's name and Close over a
 * body that takes the rest. Close closes the window the way the person
 * opened it; the host decides what happens where it cannot.
 */
export function WorkbenchPane({
  pane,
  onClose,
  children,
}: {
  pane: WorkbenchPaneId;
  onClose: () => void;
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
        <button
          type="button"
          className="ui-term-pane-btn"
          onClick={onClose}
          aria-label="Close this window"
          title="Close this window"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>
      <div className="ui-workbench-pane-body">{children}</div>
    </section>
  );
}
