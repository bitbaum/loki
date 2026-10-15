"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { FileText } from "lucide-react";
import { PromptPicker } from "@/components/prompts/PromptPicker";
import type { PromptTemplate } from "@/config/prompt-library";
import { TerminalCommandList } from "./TerminalActions";

/**
 * What "/" opens above the session box: the agent's own commands, Loki's
 * records to attach, and the prompt library — one scrolling panel.
 *
 * It opens upward and may only be as tall as the screen above the box: on a
 * 320×568 phone a fixed 70dvh ran it off the top, and the prompt list, the
 * one part that needs room, was squeezed to nothing. The commands and the
 * records fold to one row each so the library gets what is left.
 */
export function SessionPicker({
  anchorRef,
  agent,
  project,
  tab,
  feedbackEmpty,
  onKey,
  onAttachFeedback,
  onPick,
  onClose,
}: {
  /** The box it opens above — measured for the room it has. */
  anchorRef: RefObject<HTMLElement | null>;
  agent: string | null;
  project: string | null;
  tab: string;
  /** Loki has already said it holds no reports for this project. */
  feedbackEmpty: boolean;
  /** One of the agent's commands, as keystrokes. */
  onKey: (bytes: string) => void;
  onAttachFeedback: () => void;
  onPick: (resolved: string, template: PromptTemplate) => void;
  onClose: () => void;
}) {
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const top = anchorRef.current?.getBoundingClientRect().top;
      if (top !== undefined) setRoom(Math.max(160, Math.floor(top - 8)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchorRef]);

  return (
    <div
      className="ui-session-picker"
      style={room ? ({ "--picker-room": `${room}px` } as CSSProperties) : undefined}
    >
      <TerminalCommandList agent={agent} onKey={onKey} />
      {project && (
        <button type="button" className="ui-session-picker-row" onClick={onAttachFeedback}>
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-left">
            Attach {project}&apos;s feedback reports
            <span className="block text-micro text-text-muted">
              {feedbackEmpty
                ? "Loki holds none yet."
                : "From Loki — the agent cannot see them otherwise."}
            </span>
          </span>
        </button>
      )}
      <PromptPicker
        className="min-h-60"
        projectName={project ?? tab}
        projectScopedOnly
        onPick={onPick}
        onClose={onClose}
      />
    </div>
  );
}
