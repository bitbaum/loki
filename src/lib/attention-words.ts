/**
 * Why a project needs you, in words a person would say.
 *
 * lib/project-attention decides WHETHER a project needs you, from two health
 * strings, and names it with the words Control has always used ("last run:
 * needs attention"). Those words decide nothing for the reader: the owner saw
 * "last run: needs attention" under two project names on Home and could not
 * tell what had happened to either (2026-10-22). This turns the run's own
 * record — its error, its stated blocker, how it ended, what it said is next —
 * into one plain sentence, the way the failure rows above it already read.
 *
 * Pure: give it what the caller has; every field is optional.
 */
export type AttentionWordsInput = {
  sessionHealth?: string | null;
  runHealth?: string | null;
  outcome?: string | null;
  /** The run's error, when it failed. */
  error?: string | null;
  /** What the agent said is blocking it (summary["block-reason"]). */
  blockReason?: string | null;
  /** What the agent said comes next (summary.next). */
  next?: string | null;
};

const MAX = 90;

function firstSentence(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  const cut = one.search(/[.!?](\s|$)/);
  const s = cut > 0 ? one.slice(0, cut) : one;
  return s.length > MAX ? `${s.slice(0, MAX - 1).trimEnd()}…` : s;
}

export function attentionWords(input: AttentionWordsInput): string {
  if (input.error?.trim()) return `Stopped: ${firstSentence(input.error)}`;
  if (input.blockReason?.trim()) return `Stuck: ${firstSentence(input.blockReason)}`;
  const next = input.next?.trim() ? ` — next: ${firstSentence(input.next)}` : "";
  switch (input.outcome) {
    case "failed":
      return `The last run failed${next}`;
    case "timeout":
      return `The last run ran out of time${next}`;
    case "partial":
      return `The last run only got part of the way${next}`;
  }
  const session = input.sessionHealth?.toLowerCase() ?? "";
  if (session === "critical") return "The agent reports something is badly wrong";
  if (session.includes("attention")) return "The agent asked you to take a look";
  const run = input.runHealth?.toLowerCase() ?? "";
  if (run === "critical") return `The last run ended badly${next}`;
  if (run.includes("attention")) return `The last run asked you to take a look${next}`;
  return "Needs a look";
}
