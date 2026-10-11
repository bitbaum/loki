/**
 * What a finished run hands back to the chat that started it.
 *
 * The agent closes every run with a summary (OrchestrationTaskSummary): what
 * it did, what should come next, what it checked. Activity and the digests
 * read it; the Loki chat that dispatched the work did not — its card ended at
 * "Done · See the result →", a link to another page, so learning what had
 * happened, and deciding what to do about it, meant leaving the conversation.
 *
 * This is that summary in the chat's terms: a few lines of what changed, one
 * line of what was checked, and the agent's own next steps — each one a tap
 * that carries on in the same chat, on the same project. Pure, so it is tested
 * without a run (scripts/test/run-handoff.ts). Agent text is shown as text.
 */
import type { OrchestrationTaskSummary } from "@/lib/orchestration/contract";
import { splitSessionItems } from "@/lib/session-content";

export type RunHandoff = {
  done: string[];
  checked: string | null;
  next: string[];
};

const DONE_MAX = 4;
const NEXT_MAX = 3;
const ITEM_CHARS = 240;
const NEXT_CHARS = 160;

/** Words an agent writes when it has nothing to say in a field. */
const EMPTY = /^(none|n\/a|na|-|—|nothing|tbd|unknown|not run|skipped)\.?$/i;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function items(text: unknown, max: number, chars: number): string[] {
  if (typeof text !== "string") return [];
  const seen = new Set<string>();
  return splitSessionItems(text.replace(/\s*\n+\s*[-*•]?\s*/g, "; "))
    .map((s) => s.replace(/^[-*•]\s*/, "").trim())
    .filter((s) => s && !EMPTY.test(s))
    .filter((s) => (seen.has(s.toLowerCase()) ? false : (seen.add(s.toLowerCase()), true)))
    .slice(0, max)
    .map((s) => clip(s, chars));
}

/**
 * The handoff, or null when the run left nothing worth showing (no summary,
 * or one whose every field is empty) — the card then reads as it always did.
 */
export function runHandoff(
  summary: Partial<OrchestrationTaskSummary> | null | undefined,
): RunHandoff | null {
  if (!summary || typeof summary !== "object") return null;
  const done = items(summary.done, DONE_MAX, ITEM_CHARS);
  const next = items(summary.next, NEXT_MAX, NEXT_CHARS);
  const tests = typeof summary.tests === "string" ? summary.tests.trim() : "";
  const checked = tests && !EMPTY.test(tests) ? clip(tests.replace(/\s+/g, " "), ITEM_CHARS) : null;
  if (!done.length && !next.length && !checked) return null;
  return { done, checked, next };
}

/** What a tapped next step sends: the step, said as an instruction. */
export function nextStepPrompt(step: string): string {
  return `Next: ${step}`;
}
