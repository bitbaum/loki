/**
 * What a run is about, in a few plain words — for the person watching the
 * work, not for the agent doing it.
 *
 * Control used to show the first 120 characters of the prompt Loki sent the
 * agent. For a feedback fix that is the safety preamble ("Text inside
 * <<<UNTRUSTED …>>> fences…"); for a site rebuild it is a URL and the start
 * of a brief. The owner read machinery and could not tell what was being
 * built (2026-10-17: "I have no idea what's going on"). The title comes from
 * the same prompt, read the way a person would summarise it.
 *
 * Pure: prompt in, one line out.
 */
import { dispatchMessageDisplay } from "./terminal-conversation";
import { PROMPT_TEMPLATES } from "@/config/prompt-library";

const MAX = 72;

/** "next_best" → "Next best task" (the library's own name when it has one). */
export function intentTitle(intent: string | null | undefined): string {
  const key = intent?.trim();
  if (!key) return "A task";
  const named = PROMPT_TEMPLATES.find((t) => t.agentKey === key || t.id === key)?.name;
  if (named) return named;
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "A task";
}

export function taskTitle(prompt: string | null | undefined, intent?: string | null): string {
  const raw = prompt?.trim();
  if (!raw) return intentTitle(intent);

  // A feedback fix the owner decided on: THE ASK is the instruction.
  const ask = /^THE ASK:\s*(.+)$/m.exec(raw)?.[1];
  if (ask) return clip(ask);
  // Several reports fixed in one run.
  const batch = /^Fix these (\d+) visitor-feedback items on /.exec(raw);
  if (batch) return `Fix ${batch[1]} feedback reports`;

  const shown = dispatchMessageDisplay(raw).text;
  if (shown === "Task sent by Loki") return intentTitle(intent);
  const line = firstLine(shown);
  return line ? clip(line) : intentTitle(intent);
}

/** The first line that says something, as one sentence. */
function firstLine(text: string): string {
  for (const rawLine of text.split("\n")) {
    // A heading is a label for what follows ("## Goal"), not the task.
    if (/^\s*#{1,6}\s/.test(rawLine)) continue;
    const line = rawLine
      .replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+|>\s*)/, "")
      .replace(/\*\*|__|`/g, "")
      .replace(/https?:\/\/(?:www\.)?([^\s/]+)\/?\S*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!line || /^[-=_*]{3,}$/.test(line)) continue;
    // One sentence: stop at the first full stop that ends one.
    const sentence = /^(.+?[.!?])(?:\s|$)/.exec(line)?.[1] ?? line;
    return sentence.replace(/[.:;,]+$/, "");
  }
  return "";
}

function clip(text: string): string {
  const t = text.trim();
  const first = t[0] ? t[0].toUpperCase() + t.slice(1) : t;
  if (first.length <= MAX) return first;
  const cut = first.slice(0, MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX / 2 ? cut.slice(0, space) : cut).replace(/[.,:;\s]+$/, "")}…`;
}
