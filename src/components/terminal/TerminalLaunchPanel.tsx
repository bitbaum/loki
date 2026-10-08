"use client";

import type { ComponentProps } from "react";
import { TerminalLaunch } from "./TerminalLaunch";

/**
 * The strip's "+": the same start-an-agent form the empty state uses, opened in
 * place under the tabs with a way to put it away again. Desktop only — the
 * phone starts sessions from its sheet.
 */
export function TerminalLaunchPanel({
  onCancel,
  ...launch
}: ComponentProps<typeof TerminalLaunch> & { onCancel: () => void }) {
  return (
    <div className="hidden items-start gap-2 md:flex">
      <TerminalLaunch {...launch} />
      <button type="button" className="ui-btn-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
