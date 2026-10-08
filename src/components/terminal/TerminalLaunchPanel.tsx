"use client";

import type { ComponentProps } from "react";
import { X } from "lucide-react";
import { TerminalLaunch } from "./TerminalLaunch";

/**
 * The strip's "+": the same start-an-agent form the empty state uses, opened in
 * place under the tabs with a way to put it away again. The close control sits
 * on the card itself — beside it, it floated free of the thing it dismisses.
 * Desktop only — the phone starts sessions from its sheet.
 */
export function TerminalLaunchPanel({
  onCancel,
  ...launch
}: ComponentProps<typeof TerminalLaunch> & { onCancel: () => void }) {
  return (
    <div className="relative hidden w-full max-w-xl md:block">
      <TerminalLaunch {...launch} />
      <button
        type="button"
        className="ui-btn-icon absolute right-2 top-5"
        aria-label="Close"
        title="Close"
        onClick={onCancel}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
