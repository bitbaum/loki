"use client";

import type { ComponentProps } from "react";
import { Modal } from "@/components/ui/modal";
import { TerminalLaunch } from "./TerminalLaunch";

/**
 * The phone's "+": the same start-a-session form the desktop strip opens, in a
 * bottom sheet. It closes as soon as the session is asked for — the header's
 * row of sessions is where the new one appears, already selected.
 */
export function TerminalNewSessionSheet({
  onClose,
  onStarted,
  onOpenSession,
  ...launch
}: ComponentProps<typeof TerminalLaunch> & { onClose: () => void }) {
  return (
    <Modal onClose={onClose} position="bottom-mobile" padded={false} size="md" className="ui-sheet">
      <div className="ui-sheet-grip" aria-hidden="true" />
      <div className="ui-sheet-body">
        <TerminalLaunch
          {...launch}
          framed={false}
          onStarted={(tab) => {
            onStarted?.(tab);
            onClose();
          }}
          onOpenSession={(tab) => {
            onOpenSession?.(tab);
            onClose();
          }}
        />
      </div>
      <div className="ui-sheet-foot">
        <button type="button" className="ui-btn-secondary w-full" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
