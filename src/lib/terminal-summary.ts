/**
 * The terminal's AI summary: what to ask, what to attach, and how to read the
 * answer back into actions.
 *
 * It rides Loki's ordinary Ask path (a chat-only conversation turn) with the
 * session's screen as a text attachment, so there is no second model plumbing:
 * the same thread, model picker and failure handling as every Ask.
 */
import type { TextAttachment } from "@/lib/loki/attachments";
import type { TerminalRunPresentation } from "@/lib/terminal-run-view";
import { commandGuide } from "@/lib/terminal-commands";

/** Rows of rendered terminal read back for a summary (a few screens). */
export const SUMMARY_WINDOW_ROWS = 400;
/** Fits under the messages route's attachment limits with room to spare. */
export const SUMMARY_MAX_CHARS = 12_000;
/** The bottom of the screen sent with an ordinary Ask — enough to answer
 *  "what is this error?", small enough to ride along with every question. */
export const ASK_SCREEN_CHARS = 4_000;

/** Lines of the answer that are actions start with this marker. */
const ACTION_MARKER = "→";

/** What the person sees as their own message — the button's words. */
export const SUMMARY_REQUEST = "What's going on?";

/**
 * The instruction sent with the screen. The `→` contract is what lets the
 * panel turn each action into a one-tap inject.
 *
 * Written for the person the button is for: someone looking at a terminal on
 * a phone who cannot read it and should not have to. The answer gives them
 * both of the things the product promises — the steering wheel (the `→`
 * steps, each one tap) and permission to let go (the Autopilot line says,
 * honestly, whether it can carry on without them). "Summarize this session"
 * produced a log digest for an engineer (operator, 2026-10-07).
 */
export function summaryPrompt(project: string, agent?: string | null): string {
  const guide = commandGuide(agent);
  return [
    `What's going on with ${project}? The attached file is the coding agent's terminal as it looks right now.`,
    "Answer for someone who is not a programmer, in this shape and nothing else:",
    "1. If anything is failing, stuck or waiting on me, say that first, in one sentence, with what I need to do.",
    "2. One or two sentences: what the agent is building right now and how far along it is. Name what I will see (a page, a feature, a fix), not file names or commands, unless that is all the screen shows.",
    '3. One line starting "Autopilot: " — can it keep going without me? Either "nothing needs you, it carries on by itself" or exactly what will stop it.',
    `4. Up to three things I could tell it next, one per line, each starting with "${ACTION_MARKER} " and written as the instruction itself, the most useful first.`,
    "Short, plain, warm. No preamble, no headings. If the screen shows nothing useful, say so in one line.",
    ...(guide ? [COMMANDS_RULE, guide] : []),
  ].join("\n");
}

/**
 * Why the agent's commands are in the prompt at all: a screen that says "Please
 * run /login" used to get "it is waiting on you" and a prose task, which the
 * agent cannot act on while signed out. A step that IS a command becomes a
 * button that types it (TerminalLokiRail, lib/terminal-commands.commandIn).
 */
const COMMANDS_RULE = `The agent also understands its own commands, typed into the terminal. When the screen or my question calls for one (it says it is signed out, I want a different model, it is out of quota or memory), make that step the command alone, e.g. "${ACTION_MARKER} /login", and say in plain words what it will do. Never invent a command that is not in this list:`;

/**
 * What an Ask from the terminal panel carries: which agent is running, the
 * commands it understands, and the bottom of its screen — so the answer is
 * about this session, and a command it recommends arrives as a step.
 */
export function terminalContextAttachment(
  agent: string | null | undefined,
  screen: string,
): TextAttachment {
  const guide = commandGuide(agent);
  const parts = [
    `The coding agent in this terminal: ${agent ?? "unknown"}.`,
    ...(guide ? [COMMANDS_RULE, guide] : []),
    "The bottom of its terminal right now:",
    screen || "(the terminal is empty)",
  ];
  return { kind: "text", name: "terminal-context.txt", content: parts.join("\n") };
}

export function screenAttachment(
  screen: string,
  run: TerminalRunPresentation | null,
): TextAttachment {
  const header = run ? `Run status: ${run.label} — ${run.stepSummary}. ${run.nextAction}\n\n` : "";
  return { kind: "text", name: "terminal-screen.txt", content: `${header}${screen}` };
}

/** Split an answer into what to read and what can be sent. */
export function splitActions(content: string): { body: string; actions: string[] } {
  const body: string[] = [];
  const actions: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(ACTION_MARKER)) {
      const action = trimmed.slice(ACTION_MARKER.length).trim();
      if (action) actions.push(action);
    } else body.push(line);
  }
  return { body: body.join("\n").trim(), actions };
}
