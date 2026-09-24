/**
 * Terminal modes — SSOT for the two axes the terminal can be switched along.
 *
 * Before this file the terminal had exactly one switch (Cloud / This computer)
 * rendered as two loose chips, and no way at all to change how you talk to the
 * session. Everything else — picking an agent, composing a prompt with project
 * context, speaking a task — lived on OTHER pages, so driving one agent meant
 * moving between Terminal, Control and Prompts.
 *
 * The two axes are genuinely orthogonal, which is why they are two lists and
 * not one:
 *
 *   SOURCE  — *where* the session runs. Changes which transport streams bytes.
 *   INPUT   — *how* your words reach it. Changes what happens to what you type:
 *             raw bytes, an assembled prompt, or speech.
 *
 * Agent selection is a third switch but it is not enumerable here: the roster
 * comes from the adapter registry at runtime (see /api/terminal/context).
 */

export type TerminalSource = "cloud" | "machine" | "shell";

export type TerminalInputMode = "type" | "prompt" | "voice";

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
    label: "Cloud builder",
    hint: "View cloud-builder sessions. Starting directly below will also use the cloud builder; project defaults stay unchanged.",
  },
  {
    id: "machine",
    label: "Your computer",
    hint: "View sessions on your computer. Starting directly below will also use your computer; project defaults stay unchanged.",
  },
  {
    id: "shell",
    label: "Server shell",
    hint: "A plain bash PTY owned by this server — tabs and splits, no agent.",
  },
];

/**
 * Input options. These are three different code paths, not three skins:
 *   type   → transport.sendKey — verbatim bytes, so Ctrl-C, arrows and TUI
 *            keybindings behave exactly as they do in a local terminal.
 *   prompt → /api/control/tab-inject — the text is assembled with project
 *            context first, and is QUEUED if the builder is offline.
 *   voice  → record → Whisper → the same tab-inject path.
 */
export const TERMINAL_INPUT_MODES: TerminalModeOption<TerminalInputMode>[] = [
  {
    id: "type",
    label: "Type",
    hint: "Keystrokes go straight to the session. Ctrl-C, arrows and paste all work.",
  },
  {
    id: "prompt",
    label: "Prompt",
    hint: "Compose a task. It is assembled with project context, and queued if the builder is offline.",
  },
  {
    id: "voice",
    label: "Voice",
    hint: "Speak a task. It is transcribed and dispatched into this tab.",
  },
];

export function terminalSourceHint(id: TerminalSource): string {
  return TERMINAL_SOURCES.find((s) => s.id === id)?.hint ?? "";
}

export function terminalInputHint(id: TerminalInputMode): string {
  return TERMINAL_INPUT_MODES.find((m) => m.id === id)?.hint ?? "";
}

/** Persisted so reopening the terminal restores how you were working. */
export const TERMINAL_MODE_STORAGE_KEY = "loki:terminal-mode";

/** Whether the Loki rail beside the terminal is open (wide screens). Closed,
 *  the session takes the full row. */
export const TERMINAL_RAIL_STORAGE_KEY = "loki:terminal-rail";

/** The width at which the Loki rail sits beside the terminal rather than in a
 *  sheet. Must match `lg:` on `.ui-term-split-rail` in globals.css. */
export const TERMINAL_RAIL_QUERY = "(min-width: 1024px)";
