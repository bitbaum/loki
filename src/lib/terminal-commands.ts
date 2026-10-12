/**
 * What to TYPE into the terminal next, read off what the screen shows.
 *
 * The suggestion chips (lib/terminal-suggestions) are tasks: sentences for the
 * agent to work on. Some screens need something else entirely — the agent's
 * own command, or a key. "Invalid API key · Please run /login" is not waiting
 * on a task; it is waiting on someone to type `/login`, and a person who has
 * never used a terminal does not know that (operator, 2026-10-12). These are
 * those keystrokes, each with the sentence that says why, one click from the
 * session.
 *
 * Pure: screen lines in, actions out. Which commands exist is SSOT in
 * config/agent-commands; which bytes a key sends is SSOT in config/terminal-keys.
 */
import { commandOfKind, commandsFor, type AgentCommand } from "@/config/agent-commands";
import { TERMINAL_KEYS } from "@/config/terminal-keys";

/** Rows from the bottom of the screen worth reading — the live part. */
export const COMMAND_WINDOW_ROWS = 40;

export type TerminalAction = {
  /** Stable across polls, so a re-read does not re-render for nothing. */
  id: string;
  /** The button's words. */
  label: string;
  /** What will be typed, shown in the terminal's own font. */
  display: string;
  /** Verbatim bytes written into the session. */
  bytes: string;
  /** One sentence: what the screen says, and what this does about it. */
  why: string;
};

const SIGNED_OUT_RE =
  /(please run \/login|run \/login|invalid api key|missing api key|not logged in|please (?:log|sign) in|oauth token (?:has )?expired|authentication_error|\/auth to (?:sign|log) in)/i;
const OUT_OF_QUOTA_RE =
  /(usage limit|rate limit(?:ed| reached| exceeded)|limit reached|hit your (?:usage )?limit|out of credits|quota exceeded|credit balance is too low)/i;
const CONTEXT_LEFT_RE = /context left until auto-compact:\s*(\d+)%/i;
const CONTEXT_FULL_RE = /(prompt is too long|context window (?:is )?(?:full|exceeded))/i;
/** Below this, Claude Code is about to compact on its own at a moment it picks. */
const CONTEXT_LOW_PERCENT = 10;
/** A highlighted row of a numbered menu ("❯ 1. Yes"), the shape every agent CLI draws. */
const MENU_CURSOR_RE = /^\s*[❯›▶>]\s*\d+\.\s+\S/;
const MENU_ROW_RE = /^\s*\d+\.\s+\S/;

/** A command written as an action: typed, then Enter. */
export function commandAction(command: AgentCommand, why: string): TerminalAction {
  return {
    id: `cmd:${command.text}`,
    label: command.label,
    display: command.text,
    bytes: `${command.text}\r`,
    why,
  };
}

/**
 * Up to three things to type, most urgent first. Empty when the screen needs
 * nothing typed — the task chips cover that case, and inventing a command for
 * a screen that is simply working would be noise.
 */
export function screenActions(
  screen: readonly string[],
  agent: string | null | undefined,
): TerminalAction[] {
  const lines = screen
    .slice(-COMMAND_WINDOW_ROWS)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  const recent = lines.slice(-15);
  const text = recent.join("\n");
  const out: TerminalAction[] = [];
  const add = (a: TerminalAction | null) => {
    if (a && out.length < 3 && !out.some((x) => x.id === a.id)) out.push(a);
  };

  // A menu is waiting on a choice: nothing else can be typed until it is
  // answered, so it comes first.
  const menuAt = recent.findIndex((l) => MENU_CURSOR_RE.test(l));
  if (menuAt >= 0 && recent.some((l, i) => i !== menuAt && MENU_ROW_RE.test(l))) {
    const highlighted = recent[menuAt]!.replace(/^\s*[❯›▶>]\s*/, "").trim();
    add({
      id: "key:enter",
      label: "Choose the highlighted option",
      display: "Enter",
      bytes: TERMINAL_KEYS.enter.bytes,
      why: `The agent is asking you to pick one, and “${highlighted.slice(0, 60)}” is highlighted.`,
    });
    add({
      id: "key:down",
      label: "Highlight the next option",
      display: "↓",
      bytes: TERMINAL_KEYS.down.bytes,
      why: "Moves the highlight down one row. Choose it once it is on the one you want.",
    });
    add({
      id: "key:esc",
      label: "Close this menu",
      display: "Esc",
      bytes: TERMINAL_KEYS.esc.bytes,
      why: "Leaves the menu without choosing anything.",
    });
    return out;
  }

  const login = commandOfKind(agent, "login");
  if (login && SIGNED_OUT_RE.test(text)) {
    add(
      commandAction(
        login,
        "The agent is signed out, so it cannot do anything until it signs in again. This prints a link to open and approve.",
      ),
    );
  }

  const model = commandOfKind(agent, "model");
  if (model && OUT_OF_QUOTA_RE.test(text)) {
    add(
      commandAction(
        model,
        "This model has used up its limit for now. Pick another one and the agent can carry on.",
      ),
    );
  }

  const compact = commandOfKind(agent, "compact");
  const left = CONTEXT_LEFT_RE.exec(text);
  if (compact && ((left && Number(left[1]) <= CONTEXT_LOW_PERCENT) || CONTEXT_FULL_RE.test(text))) {
    add(
      commandAction(
        compact,
        "The agent's memory of this conversation is nearly full. This condenses it so it can keep going.",
      ),
    );
  }
  return out;
}

/** Same actions → same array, so a poll does not re-render for nothing. */
export function sameActions(a: readonly TerminalAction[], b: readonly TerminalAction[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i]?.id && x.why === b[i]?.why);
}

const COMMAND_SHAPE_RE = /^\/[a-z][\w:-]*(?: [^\n]*)?$/i;

/**
 * A slash command written by a person or a model — "/model opus", "`/login`",
 * "Type /compact" — as the exact text to type, or null when it is prose.
 *
 * Only commands the running agent knows count. Prose that happens to start
 * with a slash ("/api/users returns 500 — fix it") is a task and must keep
 * travelling as one.
 */
export function commandIn(text: string, agent: string | null | undefined): string | null {
  const known = commandsFor(agent);
  if (known.length === 0) return null;
  const bare = text
    .trim()
    .replace(/^(?:type|run|enter|send)\s+/i, "")
    .replace(/^`+|`+$/g, "")
    .replace(/[.。]$/, "")
    .trim();
  if (!COMMAND_SHAPE_RE.test(bare)) return null;
  const head = bare.split(" ")[0]!.toLowerCase();
  return known.some((c) => c.text.split(" ")[0] === head) ? bare : null;
}

/**
 * The commands, as the summary model needs to see them: one per line, the
 * exact text and when to use it. The model offers one as a step ("→ /login")
 * only when the screen or the person's question calls for it.
 */
export function commandGuide(agent: string | null | undefined): string | null {
  const known = commandsFor(agent);
  if (known.length === 0) return null;
  return known.map((c) => `${c.text} — ${c.label}: ${c.hint}`).join("\n");
}
