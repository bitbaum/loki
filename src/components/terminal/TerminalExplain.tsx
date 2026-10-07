"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { TERMINAL_RAIL_QUERY } from "@/config/terminal-modes";

/**
 * "What's going on?" — the one question a person watching an agent actually
 * has. A TUI is not readable by most people on a phone; the answer is two
 * sentences and the choices that follow — steer it, or leave it running
 * (operator, 2026-10-07).
 *
 * The Loki sheet opens on request only. It used to open by itself on phones
 * whenever the URL carried a run — every "Open the full terminal" tap — and
 * covered the session the person had just asked to see. The exception is a
 * person who asked: `?explain=1` is this question tapped on another page.
 */
export function useTerminalExplain(
  initialExplain: boolean,
  /** The rail can sit beside the session; the answer goes there, not a sheet. */
  railFits: boolean,
  openRail: () => void,
) {
  const [sheetOpen, setSheetOpen] = useState(
    () =>
      initialExplain &&
      typeof window !== "undefined" &&
      !window.matchMedia(TERMINAL_RAIL_QUERY).matches,
  );
  // Each tap bumps `request`; the rail answers each value once and reports it,
  // so a sheet that remounts the rail does not ask the same question again.
  const [request, setRequest] = useState(initialExplain ? 1 : 0);
  const [answered, setAnswered] = useState(0);
  return {
    sheetOpen,
    setSheetOpen,
    pending: request > answered ? request : 0,
    onAnswered: setAnswered,
    ask: () => {
      setRequest((n) => n + 1);
      if (railFits) openRail();
      else setSheetOpen(true);
    },
  };
}

export function TerminalExplainButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ui-btn-secondary w-full shrink-0 justify-center gap-2"
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      What&apos;s going on?
    </button>
  );
}

/** The Loki rail as a bottom sheet, where it cannot sit beside the session.
 *  lg:hidden — on wide screens the same rail is in the split instead, and one
 *  React element must never be mounted in both. */
export function TerminalLokiSheet({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="lg:hidden">
      <Modal
        onClose={onClose}
        position="bottom-mobile"
        size="lg"
        padded={false}
        className="ui-sheet"
      >
        <div className="ui-term-loki-sheet">{children}</div>
      </Modal>
    </div>
  );
}
