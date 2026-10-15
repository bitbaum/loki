/**
 * Which next steps to show, held still long enough to be read
 * (hooks/use-stable-steps is the clock around it).
 *
 * One set per `key` — the settled screen or the agent's last reply — chosen
 * when the model's steps arrive or the wait runs out, then kept: a late model
 * answer does not reshuffle chips someone is reading, and `hold` (the person
 * is typing) freezes whatever is shown.
 */
import { mergeSteps } from "@/lib/terminal-next-steps";

export type ShownSteps = { key: string; steps: string[] } | null;

export function nextShownSteps(input: {
  shown: ShownSteps;
  key: string | null;
  ai: readonly string[] | null;
  rules: readonly string[];
  /** The wait for the model ran out for this key. */
  timedOut: boolean;
  hold: boolean;
}): ShownSteps {
  const { shown, key, ai, rules, timedOut, hold } = input;
  if (key === null || hold || shown?.key === key) return shown;
  if (ai === null && !timedOut) return shown;
  return { key, steps: mergeSteps(ai, rules) };
}

/** What the chips show: nothing while there is nothing to answer. */
export function visibleSteps(shown: ShownSteps, key: string | null): string[] {
  return key === null ? [] : (shown?.steps ?? []);
}
