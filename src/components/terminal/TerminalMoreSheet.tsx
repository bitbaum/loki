"use client";

import { Minus, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { TerminalFontControl } from "@/hooks/use-terminal-font";
import { usePressVerb } from "@/hooks/use-press-verb";
import { OptionRow, SheetSection } from "./sheet-rows";

/**
 * The phone header's "⋮": what is asked rarely, about the session rather than
 * of it — Loki's read of the run, full screen, and how the screen is drawn.
 *
 * These sat at the bottom of the session sheet, under the sessions and the
 * agent, so "make the text bigger" meant scrolling past every session you
 * had open. The session name now opens the sessions; this opens the rest.
 */
export function TerminalMoreSheet({
  onClose,
  onExplain,
  immersive,
  onToggleImmersive,
  font,
  columns,
  liveKeys,
  onLiveKeysChange,
}: {
  onClose: () => void;
  /** Loki explains the session; omitted without a project. */
  onExplain?: () => void;
  immersive: boolean;
  onToggleImmersive?: () => void;
  font: TerminalFontControl;
  columns: number | null;
  /** Hand keystrokes to xterm itself instead of the session box. */
  liveKeys: boolean;
  onLiveKeysChange: (value: boolean) => void;
}) {
  const press = usePressVerb();
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Modal
      onClose={onClose}
      position="bottom-mobile"
      padded={false}
      size="md"
      className="ui-sheet"
      labelledBy="more-sheet-title"
    >
      <div className="ui-sheet-grip" aria-hidden="true" />
      <div className="ui-sheet-body">
        <h2 id="more-sheet-title" className="sr-only">
          More
        </h2>
        <SheetSection label="This session">
          {onExplain && (
            // The supervisor, as distinct from the agent in the session. Read
            // when stuck, not every minute.
            <OptionRow
              title="What's going on?"
              detail="Loki reads the session and says what it is doing and what to do next — on Loki's own model, not the agent's."
              active={false}
              onSelect={act(onExplain)}
            />
          )}
          {onToggleImmersive && (
            <OptionRow
              title={immersive ? "Leave full screen" : "Full screen"}
              detail={
                immersive
                  ? "Back to the header and the session box."
                  : "Every line of the screen for the session; the box folds to Esc and Enter."
              }
              active={immersive}
              onSelect={act(onToggleImmersive)}
            />
          )}
        </SheetSection>

        <SheetSection label="Display">
          <div className="ui-sheet-row">
            <span className="min-w-0 flex-1 text-sm text-text-secondary">
              Text size
              {columns ? <span className="ui-sheet-option-detail">{columns} columns</span> : null}
            </span>
            <button
              type="button"
              className="ui-term-font-btn"
              onClick={() => font.step(-1)}
              aria-label="Smaller text, more columns"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ui-term-font-btn"
              onClick={() => font.step(1)}
              aria-label="Larger text, fewer columns"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={cn("ui-term-font-reset", font.size === null && "ui-term-font-reset-on")}
              onClick={font.reset}
            >
              Auto
            </button>
          </div>

          {/* The escape hatch for the one thing the box cannot do: send a
              keystroke the moment it is pressed — a raw password prompt, a
              TUI that filters as you type. Off by default because on a phone
              it is also the worse experience. */}
          <OptionRow
            title="Live keystrokes"
            detail={
              liveKeys
                ? `Keys go straight to the session as you press them. ${press.Verb} the screen to focus it first.`
                : `Off (recommended): ${press.verb} the screen and you write in the box under it — with the microphone and screenshots. On: every key goes straight into the session, for a password prompt or a menu's own search.`
            }
            active={liveKeys}
            onSelect={() => onLiveKeysChange(!liveKeys)}
          />
        </SheetSection>
      </div>

      <div className="ui-sheet-foot">
        <button type="button" className="ui-btn-secondary w-full" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
