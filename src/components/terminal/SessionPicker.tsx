"use client";

import { createPortal } from "react-dom";
import { FileText, ImagePlus, Keyboard } from "lucide-react";
import { PromptPicker } from "@/components/prompts/PromptPicker";
import { Modal } from "@/components/ui/modal";
import type { PromptTemplate } from "@/config/prompt-library";
import { TerminalCommandList } from "./TerminalActions";

/**
 * What "+" (or "/" in an empty box) opens: a photo or screenshot, the keys a
 * phone lacks, the agent's own commands, Loki's records to attach, and the
 * prompt library — one sheet, the way a chat app's "+" holds everything that
 * is not words.
 *
 * It is a sheet from the bottom, like every other choice on a phone. It used
 * to be a panel pinned above the box, measured for the room it had when it
 * opened; its search field then took the keyboard, the room halved, and the
 * panel ran over the session header with the commands clipped out of sight
 * (owner, 2026-10-19: "figure out the way how to avoid these jumps"). A sheet
 * does not move when the keyboard comes and goes, and nothing in it asks for
 * the keyboard until the search is pressed.
 */
export function SessionPicker({
  agent,
  project,
  tab,
  feedbackEmpty,
  onKey,
  onAttachFeedback,
  onPhoto,
  onKeys,
  onPick,
  onClose,
}: {
  /** Opens chatkit's Camera / Photos / Files choice. */
  onPhoto: () => void;
  /** Opens the key deck; omitted outside the terminal view. */
  onKeys?: () => void;
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
  return createPortal(
    <Modal
      onClose={onClose}
      position="bottom-mobile"
      padded={false}
      size="md"
      className="ui-sheet"
      labelledBy="session-picker-title"
    >
      <div className="ui-sheet-grip" aria-hidden="true" />
      <div className="ui-sheet-body">
        <h2 id="session-picker-title" className="sr-only">
          Add to the session
        </h2>
        <button type="button" className="ui-session-picker-row" onClick={onPhoto}>
          <ImagePlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-left">Photo or screenshot</span>
        </button>
        {onKeys && (
          // A computer has these keys already.
          <button type="button" className="ui-session-picker-row md:hidden" onClick={onKeys}>
            <Keyboard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-left">
              Keys
              <span className="block text-micro text-text-muted">
                Arrows, Esc, Tab, Ctrl — what a phone keyboard lacks.
              </span>
            </span>
          </button>
        )}
        <TerminalCommandList agent={agent} onKey={onKey} open />
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
          className="ui-session-picker-prompts"
          projectName={project ?? tab}
          projectScopedOnly
          onPick={onPick}
          onClose={onClose}
        />
      </div>
    </Modal>,
    document.body,
  );
}
