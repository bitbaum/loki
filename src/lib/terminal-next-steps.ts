/**
 * AI-written next steps for a running agent session — the instructions a
 * person would send next, read from what the session shows.
 *
 * The rule-based chips (lib/terminal-suggestions) answer instantly and know a
 * handful of shapes: a PR's CI, an error line, a y/n question. Everything else
 * fell through to the same three generic lines whatever the agent had just
 * said. Operator, 2026-10-05: smarter suggestions. This is one cheap call to
 * the fast model, made only once the screen or reply has stopped changing, and
 * the rules stay as the fallback while it runs or when it fails.
 *
 * Pure (prompt in, list out); the route and hook are the only I/O.
 */
import { parseFollowUps } from "@/lib/loki/follow-ups";

/** What of the session the model sees — its last screens or reply. */
export const NEXT_STEPS_INPUT_CHARS = 6000;
export const NEXT_STEPS_MAX = 3;

export type NextStepsSource = "screen" | "reply";

export const NEXT_STEPS_SYSTEM_PROMPT = [
  "You help someone steer a coding agent (Claude Code) from their phone.",
  `Reply with exactly ${NEXT_STEPS_MAX} instructions they could send the agent next, one per line, nothing else.`,
  "Each is written as the instruction itself, imperative, specific to what the agent just did or asked,",
  "under 70 characters, no numbering, no quotes.",
  'If the agent is asking a question or offering options, the first line answers it ("Yes, go ahead.", "Do option 2.").',
  "Put first the step you would recommend; the others are real alternatives, not rephrasings.",
  "Never suggest something the agent already reports as done.",
].join(" ");

export function buildNextStepsPrompt(
  context: string,
  source: NextStepsSource,
  project: string | null,
): string {
  const what =
    source === "reply" ? "The agent's latest reply:" : "The bottom of the agent's terminal:";
  const clipped = context.trim().slice(-NEXT_STEPS_INPUT_CHARS);
  return `${project ? `Project: ${project}\n` : ""}${what}\n${clipped}`;
}

/** Same parser as Loki's follow-ups: tolerant of numbering, bullets, JSON. */
export function parseNextSteps(raw: string): string[] {
  return parseFollowUps(raw).slice(0, NEXT_STEPS_MAX);
}

/**
 * AI steps first (they read the whole context), topped up from the rules, so
 * the row is never shorter than what the rules alone would show.
 */
export function mergeSteps(ai: readonly string[] | null, rules: readonly string[]): string[] {
  if (!ai || ai.length === 0) return [...rules];
  const out = [...ai];
  for (const r of rules) {
    if (out.length >= NEXT_STEPS_MAX) break;
    if (!out.some((s) => s.toLowerCase() === r.toLowerCase())) out.push(r);
  }
  return out.slice(0, NEXT_STEPS_MAX);
}
