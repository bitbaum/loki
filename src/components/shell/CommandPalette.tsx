"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  ArrowRight,
  Zap,
  FolderOpen,
  FolderKanban,
  History as HistoryIcon,
  Mic,
  MicOff,
  Loader2,
  Repeat2,
} from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { useOverlayLock } from "@/hooks/use-overlay-lock";
import type { AgentPrompt } from "@/app/api/prompts/agent/route";
import {
  buildPaletteEntries,
  filterPaletteEntries,
  type PaletteEntry,
  type UserProjectLite,
} from "./palette-entries";
import { useCommandComposer } from "./use-command-composer";
import {
  PALETTE_RECENT_STORAGE_KEY,
  LEGACY_PALETTE_RECENT_STORAGE_KEY,
} from "@/config/brand-storage";
import { cn } from "@/lib/utils";

const RECENT_LIMIT = 6;

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  // Hydrate recents once, lazily, so the order survives across page loads.
  // Migration: read loki.* first; fall back to the legacy cockpit.* key
  // so existing users don't lose their recents after the 2026-06 rebrand. The
  // next pushRecent writes under the new key, so the legacy entry stops being
  // read once the user picks anything. Within a mount, `recent` state and
  // sessionStorage are kept in step by pushRecent itself.
  const [recent, setRecent] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw =
        window.sessionStorage.getItem(PALETTE_RECENT_STORAGE_KEY) ??
        window.sessionStorage.getItem(LEGACY_PALETTE_RECENT_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  // Full-screen overlay: freeze the page under it, same as every other one.
  useOverlayLock(open);

  // Global Escape: closes the palette regardless of where focus is. The
  // input's own onKeyDown already handles Escape when focused, but that
  // breaks the moment focus moves to the mic button, a result row, or
  // anywhere else — the user's "Escape doesn't close" complaint.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const { data: agentPrompts } = useFetch<AgentPrompt[]>(open ? "/api/prompts/agent" : null);
  // User's projects appear in the palette so Cmd-K → typing the project name
  // jumps straight to /control with that project focused. Only fetched while
  // the palette is open (saves one network round-trip per page load).
  const { data: projects } = useFetch<UserProjectLite[]>(open ? "/api/user-projects" : null);

  const onTranscript = useCallback((text: string) => {
    setQuery(text);
    setHighlight(0);
    inputRef.current?.focus();
  }, []);
  const voice = useVoiceInput({ onTranscript });

  // Active project names — the candidate set the resolver matches against.
  const projectNames = useMemo(
    () => (projects ?? []).filter((p) => p.isActive !== false && p.name).map((p) => p.name),
    [projects],
  );

  const { busy, pending, note, reset, cancelPending, dispatchInject, resolveAndRun } =
    useCommandComposer({
      projectNames,
      onDispatched: () => {
        setQuery("");
        setOpen(false);
      },
      onNeedsProject: () => {
        setQuery("");
        setHighlight(0);
      },
    });

  // Opening the palette resets the composer. Guarded render-time adjustment
  // (React's "adjusting state when a prop changes" pattern) instead of an
  // effect, so the reset is visible in the same paint the palette opens on.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setHighlight(0);
      reset();
    }
  }

  useEffect(() => {
    if (!open) return;
    // Defer focus to after the modal mounts so the keystroke that opened
    // us doesn't immediately type into the input.
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  const entries = useMemo<PaletteEntry[]>(
    () => buildPaletteEntries({ agentPrompts, projects }),
    [agentPrompts, projects],
  );

  const filtered = useMemo<PaletteEntry[]>(
    () =>
      filterPaletteEntries({
        entries,
        query,
        recent,
        pending: Boolean(pending),
        projectNames,
      }),
    [entries, query, recent, pending, projectNames],
  );

  // Clamp the highlight at render time — avoids setState-in-effect when the
  // filtered range shrinks beneath the stored cursor.
  const safeHighlight = filtered.length === 0 ? 0 : Math.min(highlight, filtered.length - 1);

  const onSelect = (entry: PaletteEntry) => {
    if (entry.kind === "run-command") {
      void resolveAndRun(query);
      return;
    }
    if (entry.kind === "pick-project") {
      if (pending) void dispatchInject(entry.projectName, pending.prompt);
      return;
    }
    if (!entry.href) return;
    pushRecent(entry.key, setRecent);
    setOpen(false);
    router.push(entry.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(Math.min(filtered.length - 1, safeHighlight + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(Math.max(0, safeHighlight - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = filtered[safeHighlight];
      if (entry) onSelect(entry);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Back out of the project picker first, rather than closing the palette.
      if (pending) cancelPending();
      else setOpen(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center"
      // Click-outside-to-close: contains() handles the case where the
      // backdrop div (sibling of the panel) is the click target. The old
      // `target === currentTarget` check failed any click that landed on
      // the backdrop element itself — i.e., most "click outside the panel"
      // attempts — which is the user's "menu doesn't close" complaint.
      onMouseDown={(e) => {
        if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
      }}
    >
      <div className="ui-palette-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="ui-palette-panel"
      >
        <div className="ui-palette-input-row">
          <Search className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              voice.status === "recording"
                ? "Listening…"
                : pending
                  ? "Pick a project (type to filter)…"
                  : "Type a command (e.g. “code review for kivvi”) or search…"
            }
            className="ui-palette-input"
            spellCheck={false}
            autoComplete="off"
            disabled={voice.status === "transcribing" || busy}
          />
          {voice.isSupported && (
            <button
              type="button"
              onClick={voice.status === "recording" ? voice.stop : () => voice.start()}
              disabled={voice.status === "transcribing"}
              className={cn(
                "ui-palette-mic",
                voice.status === "recording" && "ui-palette-mic-active",
              )}
              aria-label={voice.status === "recording" ? "Stop recording" : "Voice input"}
              title={voice.status === "recording" ? "Stop" : "Voice (mic)"}
            >
              {voice.status === "transcribing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : voice.status === "recording" ? (
                <MicOff className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <kbd className="ui-palette-kbd">esc</kbd>
        </div>
        {voice.error && <div className="ui-palette-voice-error">{voice.error}</div>}
        {note && <div className="ui-palette-voice-error">{note}</div>}
        {!note && (busy || pending) && (
          <div className="ui-palette-status">
            {busy ? (
              <>
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Working…
              </>
            ) : (
              `Pick a project to run: “${pending!.prompt}”`
            )}
          </div>
        )}
        <ul className="ui-palette-list" role="listbox">
          {filtered.length === 0 ? (
            <li className="ui-palette-empty">No matches</li>
          ) : (
            filtered.map((entry, i) => (
              <li
                key={entry.key}
                role="option"
                aria-selected={i === safeHighlight}
                className={cn("ui-palette-row", i === safeHighlight && "ui-palette-row-active")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(entry);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                <span className="ui-palette-row-icon" aria-hidden="true">
                  {entry.kind === "agent-prompt" && (
                    <span className="text-base leading-none">{entry.icon}</span>
                  )}
                  {entry.kind === "prompt-template" && <Zap className="h-3.5 w-3.5" />}
                  {entry.kind === "nav" && <FolderOpen className="h-3.5 w-3.5" />}
                  {entry.kind === "project" && <FolderKanban className="h-3.5 w-3.5" />}
                  {entry.kind === "switch-agent" && <Repeat2 className="h-3.5 w-3.5" />}
                  {entry.kind === "run-command" && <Zap className="h-3.5 w-3.5" />}
                  {entry.kind === "pick-project" && <FolderKanban className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text-primary">{entry.label}</span>
                  <span className="block truncate text-xs text-text-tertiary">{entry.sub}</span>
                </span>
                {recent.includes(entry.key) && !query && (
                  <span className="ui-palette-row-meta">
                    <HistoryIcon className="h-3 w-3" aria-hidden="true" />
                    recent
                  </span>
                )}
                <ArrowRight className="ui-palette-row-arrow h-3.5 w-3.5" aria-hidden="true" />
              </li>
            ))
          )}
        </ul>
        {/* Keyboard hints only where there is a keyboard. On a phone this row
            was three shortcuts nobody can press, costing a line of the list
            that is the point of the panel. */}
        <div className="ui-palette-foot hidden md:flex">
          <span>
            <kbd className="ui-palette-kbd">↑</kbd> <kbd className="ui-palette-kbd">↓</kbd> navigate
          </span>
          <span>
            <kbd className="ui-palette-kbd">⏎</kbd> open
          </span>
          <span>
            <kbd className="ui-palette-kbd">⌘K</kbd> toggle
          </span>
        </div>
      </div>
    </div>
  );
}

function pushRecent(key: string, setRecent: React.Dispatch<React.SetStateAction<string[]>>) {
  setRecent((prev) => {
    const next = [key, ...prev.filter((k) => k !== key)].slice(0, RECENT_LIMIT);
    try {
      window.sessionStorage.setItem(PALETTE_RECENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    return next;
  });
}
