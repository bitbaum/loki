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

/**
 * The instructions for the model, naming the agent actually in the session —
 * it was always "Claude Code", so a Codex session was steered as if it were
 * Claude (its commands, its habits). Unknown agent: no name, not a guess.
 */
export function nextStepsSystemPrompt(agentLabel: string | null): string {
  return [
    `You help someone steer a coding agent${agentLabel ? ` (${agentLabel})` : ""} from their phone.`,
    ...NEXT_STEPS_RULES,
  ].join(" ");
}

const NEXT_STEPS_RULES = [
  `Reply with exactly ${NEXT_STEPS_MAX} instructions they could send the agent next, one per line, nothing else.`,
  "Each is written as the instruction itself, imperative, specific to what the agent just did or asked,",
  "under 50 characters so it reads whole on a phone, no numbering, no quotes, no markdown.",
  'Answer "yes" or "go ahead" ONLY when the agent\'s last lines literally ask for permission or a yes/no choice; never suggest picking a numbered option of an on-screen menu — a sent line is typed as text, not a keypress, so "Do option 2." reached Gemini as words while its permission menu waited (2026-10-21).',
  "If the agent says it cannot do the task because it is missing data, access or a file, do not approve anything and do not tell it to do what it just said it cannot: suggest the part it CAN do, or a different approach. Loki offers to attach the project's feedback reports on its own, so never suggest exporting or pasting them.",
  'Every line is something the person sends TO the agent — never a task for the person themselves ("request credits from the user").',
  "Put first the step you would recommend; the others are real alternatives, not rephrasings.",
  "Never suggest something the agent already reports as done.",
];

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
  // A numbered menu needs a keypress; a sent step is typed text and would
  // land in the agent as words, not a choice. Never offer one.
  const MENU_PICK = /^\s*(?:do|pick|choose|select)?\s*option\s*\d+\b|^\s*\d+\s*\.?\s*$/i;
  const picks = (ai ?? []).filter((s) => !MENU_PICK.test(s));
  if (picks.length === 0) return [...rules];
  const out = [...picks];
  for (const r of rules) {
    if (out.length >= NEXT_STEPS_MAX) break;
    if (!out.some((s) => s.toLowerCase() === r.toLowerCase())) out.push(r);
  }
  return out.slice(0, NEXT_STEPS_MAX);
}
