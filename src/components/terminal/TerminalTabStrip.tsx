"use client";

import { Fragment, useEffect, useState } from "react";
import { Pin, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type TerminalTab = {
  id: string;
  label: string;
  /** The name before any rename — what an emptied rename falls back to. */
  original?: string;
  /** Live agent CLI(s) in this tab — "claude", "grok", "claude+codex". */
  badge?: string;
  /** Dot class (`ui-dot-positive` etc). Omit for no status dot. */
  dot?: string;
  title?: string;
  /** Pinned tabs sit first and keep a pin where the Alt+N ordinal would be. */
  pinned?: boolean;
  /** Tabs of one group sit together; a divider marks where a group changes. */
  group?: string;
};

/**
 * The terminal tab strip — ONE strip for every substrate.
 *
 * Previously the two terminals disagreed about what a tab even looks like: the
 * server-shell workspace drew a real tab bar along the top, while agent
 * sessions were a 160px column of chips down the left side that collapsed to a
 * `<select>` on mobile. Same product, same page, two different mental models,
 * and neither could be switched from the keyboard — so nothing about the web
 * terminal felt like the multiplexer it is standing in for.
 *
 * This component is the shared answer. Both substrates render it, so switching
 * source changes what is behind the strip and nothing about how you navigate.
 *
 * Keyboard, matching a terminal multiplexer:
 *   Alt+1…9      jump to the nth tab
 *   Alt+←/→      previous / next tab
 *
 * Alt is chosen deliberately: Ctrl-anything belongs to the PTY (Ctrl-C must
 * stay SIGINT), and the browser owns Cmd/Ctrl+number for its own tabs. Handlers
 * bail out when the event is already consumed by an editable field.
 */
export function TerminalTabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onRename,
  onMove,
  onNudge,
  onTogglePin,
  newLabel = "New terminal",
  /** Right-hand slot — status chips, presence, etc. */
  trailing,
}: {
  tabs: TerminalTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onNew?: () => void;
  /** When given, double-clicking (or F2 on) a tab renames it in place. For
   *  agent tabs this is a display name only; the session keeps its real id. */
  onRename?: (id: string, title: string) => void;
  /** Drag a tab onto another to take its place. */
  onMove?: (id: string, targetId: string) => void;
  /** Alt+Shift+←/→ moves the active tab one step — the keyboard's drag. */
  onNudge?: (id: string, by: -1 | 1) => void;
  onTogglePin?: (id: string) => void;
  newLabel?: string;
  trailing?: React.ReactNode;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  // Closing ends a running agent, so the × arms first ("Close?") and a second
  // press confirms. It disarms on its own, so a stray tap never lingers.
  const [armedId, setArmedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  useEffect(() => {
    if (!armedId) return;
    const t = setTimeout(() => setArmedId(null), 3000);
    return () => clearTimeout(t);
  }, [armedId]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      // Never steal a key that a text field is legitimately receiving.
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement | null)?.isContentEditable
      )
        return;
      if (tabs.length === 0) return;

      const index = tabs.findIndex((t) => t.id === activeId);
      if (/^[1-9]$/.test(e.key)) {
        const target = tabs[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          onSelect(target.id);
        }
        return;
      }
      if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (onNudge && activeId) {
          e.preventDefault();
          onNudge(activeId, e.key === "ArrowRight" ? 1 : -1);
        }
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const from = index === -1 ? 0 : index;
        const next =
          e.key === "ArrowRight"
            ? (from + 1) % tabs.length
            : (from - 1 + tabs.length) % tabs.length;
        onSelect(tabs[next].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tabs, activeId, onSelect, onNudge]);

  return (
    <div className="ui-term-tabbar" role="tablist" aria-label="Terminal tabs">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab, i) => (
          <Fragment key={tab.id}>
            {i > 0 && tab.group !== undefined && tab.group !== tabs[i - 1].group && (
              <span className="ui-term-tab-sep" aria-hidden="true" />
            )}
            <div
              role="tab"
              tabIndex={0}
              aria-selected={tab.id === activeId}
              title={[
                tab.title ?? tab.label,
                onRename ? "Double-click to rename" : null,
                onMove ? "drag to reorder" : null,
              ]
                .filter(Boolean)
                .join(" — ")}
              draggable={Boolean(onMove) && editingId !== tab.id}
              onDragStart={(e) => {
                setDragId(tab.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", tab.id);
              }}
              onDragOver={(e) => {
                if (!dragId || dragId === tab.id) return;
                e.preventDefault();
                setOverId(tab.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && onMove) onMove(dragId, tab.id);
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onMouseDown={() => onSelect(tab.id)}
              onDoubleClick={() => onRename && setEditingId(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(tab.id);
                }
                if (e.key === "F2" && onRename) {
                  e.preventDefault();
                  setEditingId(tab.id);
                }
              }}
              className={cn(
                "group ui-term-tab",
                tab.id === activeId && "ui-term-tab-active",
                dragId === tab.id && "ui-term-tab-dragging",
                overId === tab.id && "ui-term-tab-drop",
              )}
            >
              {tab.dot && <span className={cn("ui-term-dot", tab.dot)} aria-hidden="true" />}
              {/* The index doubles as the Alt+N affordance — the shortcut is
                discoverable without a help panel nobody opens. A pinned tab
                shows its pin in the same slot. */}
              {tab.pinned ? (
                <Pin className="ui-term-tab-pin" aria-label="Pinned" />
              ) : (
                i < 9 && (
                  <span className="ui-term-tab-index" aria-hidden="true">
                    {i + 1}
                  </span>
                )
              )}
              {onRename && editingId === tab.id ? (
                <input
                  autoFocus
                  defaultValue={tab.label}
                  className="ui-term-tab-input"
                  aria-label={`Rename ${tab.label}`}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next) onRename(tab.id, next);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <>
                  <span className="ui-term-tab-label">{tab.label}</span>
                  {tab.badge && <span className="ui-term-tab-badge">{tab.badge}</span>}
                </>
              )}
              {onTogglePin && (
                <button
                  type="button"
                  className="ui-term-tab-close"
                  title={tab.pinned ? `Unpin ${tab.label}` : `Pin ${tab.label} to the front`}
                  aria-label={tab.pinned ? `Unpin ${tab.label}` : `Pin ${tab.label}`}
                  aria-pressed={Boolean(tab.pinned)}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onTogglePin(tab.id);
                  }}
                >
                  <Pin className="h-3 w-3" />
                </button>
              )}
              {onClose && (
                <button
                  type="button"
                  className={cn(
                    "ui-term-tab-close",
                    armedId === tab.id && "ui-term-tab-close-armed",
                  )}
                  title={
                    armedId === tab.id ? `Press again to close ${tab.label}` : `Close ${tab.label}`
                  }
                  aria-label={`Close ${tab.label}`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (armedId === tab.id) {
                      setArmedId(null);
                      onClose(tab.id);
                    } else {
                      setArmedId(tab.id);
                    }
                  }}
                >
                  {armedId === tab.id ? (
                    <span className="text-micro font-medium">Close?</span>
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                </button>
              )}
            </div>
          </Fragment>
        ))}
        {onNew && (
          <button
            type="button"
            className="ui-term-newtab"
            title={newLabel}
            aria-label={newLabel}
            onClick={onNew}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-1.5 pl-2">{trailing}</div>}
    </div>
  );
}
