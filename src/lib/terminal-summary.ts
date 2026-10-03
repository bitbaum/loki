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

/** Rows of rendered terminal read back for a summary (a few screens). */
export const SUMMARY_WINDOW_ROWS = 400;
/** Fits under the messages route's attachment limits with room to spare. */
export const SUMMARY_MAX_CHARS = 12_000;

/** Lines of the answer that are actions start with this marker. */
const ACTION_MARKER = "→";

export const SUMMARY_REQUEST = "Summarize this session";

/**
 * The instruction sent with the screen. The `→` contract is what lets the
 * panel turn each action into a one-tap inject.
 */
export function summaryPrompt(project: string): string {
  return [
    `${SUMMARY_REQUEST} for ${project}. The attached file is the agent's terminal as it looks now.`,
    "Reply in this shape, nothing else:",
    "1. Up to three short bullets: what the agent did, what it is doing now, and anything blocked, failing or waiting on me.",
    `2. Then up to three next steps I can send the agent, one per line, each starting with "${ACTION_MARKER} " and written as the instruction itself.`,
    "Plain words, no preamble. If the screen shows nothing useful, say so in one line.",
  ].join("\n");
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
