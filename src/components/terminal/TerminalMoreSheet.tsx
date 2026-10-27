"use client";

import { Keyboard, Maximize2, Minimize2, Minus, Plus, Sparkles, Type } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { List, ListRow } from "@/components/ui/list-row";
import { cn } from "@/lib/utils";
import type { TerminalFontControl } from "@/hooks/use-terminal-font";

/**
 * The phone header's "⋮": what is asked rarely, about the session rather than
 * of it — Loki's read of the run, full screen, and how the screen is drawn.
 *
 * One list of rows, each a few words — the way a phone app's "…" menu reads.
 * It was two capital-letter sections with a sentence under every row ("Every
 * line of the screen for the session; the box folds to Esc and Enter.", and
 * five lines on live keystrokes) and a Done button (owner, 2026-10-21). What a
 * row does is in its name; the one choice that needs a word more (live
 * keystrokes) says which way it is set, in one line.
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
  liveKeysFixed = false,
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
  /** A plain shell always takes the keys itself; there is no box to choose. */
  liveKeysFixed?: boolean;
}) {
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
        <List>
          {onExplain && (
            // The supervisor, as distinct from the agent in the session.
            <ListRow icon={Sparkles} title="What's going on?" onClick={act(onExplain)} />
          )}
          {onToggleImmersive && (
            <ListRow
              icon={immersive ? Minimize2 : Maximize2}
              title={immersive ? "Leave full screen" : "Full screen"}
              onClick={act(onToggleImmersive)}
            />
          )}
          <ListRow
            icon={Type}
            title="Text size"
            secondary={
              font.size === null
                ? "Fits the screen"
                : columns
                  ? `${columns} characters wide`
                  : undefined
            }
            menu={
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  className="ui-sheet-step"
                  onClick={() => font.step(-1)}
                  aria-label="Smaller text"
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ui-sheet-step"
                  onClick={() => font.step(1)}
                  aria-label="Larger text"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={cn("ui-sheet-step", font.size === null && "ui-sheet-step-on")}
                  onClick={font.reset}
                  aria-pressed={font.size === null}
                >
                  Fit
                </button>
              </span>
            }
          />
          {/* The escape hatch for the one thing the box cannot do: send a
              keystroke the moment it is pressed — a raw password prompt, a
              menu that filters as you type. Off by default because on a
              phone it is also the worse experience. */}
          <ListRow
            icon={Keyboard}
            title="Live keystrokes"
            secondary={
              liveKeysFixed
                ? "Always on in a shell: keys go straight to it"
                : liveKeys
                  ? "On: keys go straight to the session"
                  : "Off: you type in the box"
            }
            onClick={liveKeysFixed ? undefined : () => onLiveKeysChange(!liveKeys)}
            label={`Live keystrokes: ${liveKeys ? "on" : "off"}`}
            trailing={
              <span className={liveKeys ? "ui-switch ui-switch-on" : "ui-switch"} aria-hidden />
            }
          />
        </List>
      </div>
    </Modal>
  );
}
