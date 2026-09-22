/**
 * Terminal keys — SSOT for every key a phone cannot type.
 *
 * A soft keyboard has letters, digits and Return. It has no arrows, no Esc, no
 * Tab, no Ctrl. That is not a cosmetic gap: an agent TUI asks its questions with
 * exactly those keys. "Set up auto mode for your environment?" — the prompt on
 * screen when this file was written — needs ◄/► to change a value, ▲/▼ to move
 * between rows, Space to tick a checkbox and Enter to continue. On a phone,
 * every one of those was unreachable, so the operator could read the question
 * and not answer it. The terminal was a television.
 *
 * So the keys become buttons, and the bytes live here rather than inline in the
 * deck: they are protocol, not presentation. Sequences are the VT100/xterm
 * *normal* (cursor) mode forms — what ink, Bubble Tea, zellij and readline all
 * accept. Application-mode variants (ESC O A) are deliberately not used; nothing
 * in the fleet's agent CLIs requires them, and normal mode is the safer default
 * because a raw shell reads it too.
 */

export type TerminalKeyId =
  | "esc"
  | "tab"
  | "shift-tab"
  | "enter"
  | "space"
  | "backspace"
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "end"
  | "pgup"
  | "pgdn"
  | "ctrl-c"
  | "ctrl-d"
  | "ctrl-l"
  | "ctrl-r"
  | "ctrl-z"
  | "y"
  | "n"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9";

export type TerminalKey = {
  id: TerminalKeyId;
  /** What the button reads. Short — a key cap, not a sentence. */
  label: string;
  /** Verbatim bytes written to the PTY. */
  bytes: string;
  /** Screen-reader name and long-press title. */
  aria: string;
  /** Safe to auto-repeat while held (movement and deletion only — never Enter,
   *  never a control code: holding ^C should interrupt once, not forty times). */
  repeatable?: boolean;
};

const KEY = (
  id: TerminalKeyId,
  label: string,
  bytes: string,
  aria: string,
  repeatable = false,
): TerminalKey => ({ id, label, bytes, aria, repeatable });

/** Every key, by id. The lanes below select from this map. */
export const TERMINAL_KEYS: Record<TerminalKeyId, TerminalKey> = {
  esc: KEY("esc", "esc", "\x1b", "Escape — cancel or go back"),
  tab: KEY("tab", "tab", "\t", "Tab — complete or next field"),
  "shift-tab": KEY("shift-tab", "⇤", "\x1b[Z", "Shift-Tab — previous field"),
  enter: KEY("enter", "⏎", "\r", "Enter — confirm and continue"),
  space: KEY("space", "space", " ", "Space — toggle the highlighted option"),
  backspace: KEY("backspace", "⌫", "\x7f", "Backspace — delete one character", true),

  up: KEY("up", "▲", "\x1b[A", "Up — previous option", true),
  down: KEY("down", "▼", "\x1b[B", "Down — next option", true),
  left: KEY("left", "◀", "\x1b[D", "Left — previous value", true),
  right: KEY("right", "▶", "\x1b[C", "Right — next value", true),

  home: KEY("home", "home", "\x1b[H", "Home — start of line"),
  end: KEY("end", "end", "\x1b[F", "End — end of line"),
  pgup: KEY("pgup", "pgup", "\x1b[5~", "Page up", true),
  pgdn: KEY("pgdn", "pgdn", "\x1b[6~", "Page down", true),

  "ctrl-c": KEY("ctrl-c", "^C", "\x03", "Ctrl-C — interrupt what is running"),
  "ctrl-d": KEY("ctrl-d", "^D", "\x04", "Ctrl-D — end of input / exit"),
  "ctrl-l": KEY("ctrl-l", "^L", "\x0c", "Ctrl-L — clear the screen"),
  "ctrl-r": KEY("ctrl-r", "^R", "\x12", "Ctrl-R — reverse history search"),
  "ctrl-z": KEY("ctrl-z", "^Z", "\x1a", "Ctrl-Z — suspend"),

  y: KEY("y", "y", "y", "y — yes"),
  n: KEY("n", "n", "n", "n — no"),

  "1": KEY("1", "1", "1", "Choice 1"),
  "2": KEY("2", "2", "2", "Choice 2"),
  "3": KEY("3", "3", "3", "Choice 3"),
  "4": KEY("4", "4", "4", "Choice 4"),
  "5": KEY("5", "5", "5", "Choice 5"),
  "6": KEY("6", "6", "6", "Choice 6"),
  "7": KEY("7", "7", "7", "Choice 7"),
  "8": KEY("8", "8", "8", "Choice 8"),
  "9": KEY("9", "9", "9", "Choice 9"),
};

/**
 * The always-visible row: escape hatch, d-pad, commit.
 *
 * Kept to exactly this because 390 pixels is the budget and the arrows have to
 * stay finger-sized. Fitting Space here too was tried and costs Enter its
 * width — measured at 8px of remaining space, which is not a button. Enter is
 * the key that answers the question; it does not get to be the one that is
 * squeezed. Space moves one row up, into the lane.
 */
export const TERMINAL_PRIMARY_KEYS: TerminalKeyId[] = ["esc"];

/** The joined d-pad between Esc and Enter. */
export const TERMINAL_ARROW_KEYS: TerminalKeyId[] = ["left", "up", "down", "right"];

/**
 * The lane above it — scrolls horizontally.
 *
 * Grouped by what the keys do, because a flat run of twenty-four keycaps is a
 * keyboard and the point of this deck is that it is not one. The labels are
 * also what makes the sideways scroll discoverable: a cut-off word at the right
 * edge reads as "there is more", where a cut-off keycap reads as a bug.
 *
 * "Answer" is last and exists for a specific, very common prompt shape: agent
 * CLIs number their permission choices ("1. Yes  2. Yes, and don't ask again
 * 3. No"), and pressing 2 on a phone otherwise means opening the whole soft
 * keyboard to type one character.
 */
export const TERMINAL_SECONDARY_GROUPS: { label: string; keys: TerminalKeyId[] }[] = [
  { label: "Keys", keys: ["space", "tab", "shift-tab", "backspace"] },
  { label: "Signals", keys: ["ctrl-c", "ctrl-d", "ctrl-l", "ctrl-r", "ctrl-z"] },
  { label: "Move", keys: ["home", "end", "pgup", "pgdn"] },
  { label: "Answer", keys: ["y", "n", "1", "2", "3", "4", "5", "6", "7", "8", "9"] },
];

/** Hold-to-repeat timing. Long enough that a deliberate single tap never
 *  double-fires; fast enough that scrolling a 40-item list is one gesture. */
export const KEY_REPEAT_DELAY_MS = 420;
export const KEY_REPEAT_INTERVAL_MS = 85;

/** Persisted so the deck comes back the way the operator left it. */
export const TERMINAL_DECK_STORAGE_KEY = "loki:terminal-deck";

/** Nudge on every keycap: a byte sent to a busy agent can take a moment to
 *  redraw, and without a local acknowledgement the operator presses ▼ again. */
export const KEY_HAPTIC_MS = 8;
