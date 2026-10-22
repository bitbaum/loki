/**
 * Terminal modes — SSOT for where a terminal session runs and how it is shown.
 *
 * SOURCE — *where* the session runs. Changes which transport streams bytes.
 * VIEW   — *how* it is shown: the agent's conversation, or the raw terminal.
 *
 * There used to be a third axis, INPUT (Type / Prompt / Voice), which made a
 * person pick a delivery mechanism before saying anything; Type had no
 * microphone and Prompt did (operator, 2026-10-15: "isn't prompt supposed to
 * be the same thing as type?"). It is gone: one session box
 * (components/terminal/SessionComposer) carries the microphone, screenshots
 * and the prompt library, and picks the path itself.
 *
 * Agent selection is a switch too but it is not enumerable here: the roster
 * comes from the adapter registry at runtime (see /api/terminal/context).
 */

export type TerminalSource = "cloud" | "machine" | "shell";

export type TerminalModeOption<T extends string> = {
  id: T;
  label: string;
  /** One line, shown under the bar — says what changes, not what it is. */
  hint: string;
};

/**
 * Source options. `shell` is only offered where a Loki-owned PTY may be
 * provisioned (`isRuntimeAvailable()` / sandbox executor); the other two are
 * always listed so the absence of a builder reads as "offline", never as a
 * missing feature.
 */
export const TERMINAL_SOURCES: TerminalModeOption<TerminalSource>[] = [
  {
    id: "cloud",
    label: "Cloud",
    hint: "Works from any device.",
  },
  {
    id: "machine",
    label: "Your computer",
    hint: "The computer where Fleet Runner is open.",
  },
  {
    id: "shell",
    label: "Server shell",
    hint: "A command line on this server, with no agent.",
  },
];

export function terminalSourceHint(id: TerminalSource): string {
  return TERMINAL_SOURCES.find((s) => s.id === id)?.hint ?? "";
}

/**
 * How the session is SHOWN — orthogonal to source and input. `chat` reads
 * Claude Code's own session log and renders it as a conversation (the phone
 * default: 80-column TUI cells are not readable at arm's length); `terminal`
 * is the raw PTY. Same session, same keystrokes, either way.
 */
export type TerminalViewMode = "chat" | "terminal";

export const TERMINAL_VIEW_STORAGE_KEY = "loki:terminal-view";

/** Only Claude Code writes the session log the chat view reads. */
export function chatViewSupported(agentId: string | null | undefined): boolean {
  return !agentId || agentId === "claude";
}

/** Persisted so reopening the terminal restores how you were working. */
export const TERMINAL_MODE_STORAGE_KEY = "loki:terminal-mode";

/** Whether the Loki rail beside the terminal is open (wide screens). Closed,
 *  the session takes the full row. */
export const TERMINAL_RAIL_STORAGE_KEY = "loki:terminal-rail";

/** The width at which the Loki rail sits beside the terminal rather than in a
 *  sheet. Must match `lg:` on `.ui-term-split-rail` in globals.css. */
export const TERMINAL_RAIL_QUERY = "(min-width: 1024px)";
