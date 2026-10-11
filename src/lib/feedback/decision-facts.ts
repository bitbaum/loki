import { tidyFixNote } from "@/lib/feedback/fix-note";
import type { FeedbackWorkView } from "@/lib/feedback/work-phase";

/**
 * The three facts a decision card states under its headline, each on its own
 * line: what was asked, what was done about it, and what could come next.
 *
 * The owner asked for exactly this order, 2026-10-11 — "what was requested
 * before, what was stated or likely justification, what was done on that
 * front, and what else could be done" — because it is what lets a person
 * think about the next step structurally instead of re-reading a paragraph.
 * The justification is the card's headline (recommend.ts `why`); the rest
 * comes from the report and the fix's design note (fix-note.ts), with the
 * agent's one-line handoff when the pull request carried no note.
 */
export type DecisionFacts = {
  asked: string;
  done: string | null;
  next: string | null;
};

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function decisionFacts(item: {
  suggestion: string;
  work?: Pick<FeedbackWorkView, "didLine" | "ship"> | null;
}): DecisionFacts {
  const one = item.suggestion.replace(/\s+/g, " ").trim();
  // The agent-filed "--- technical details ---" tail is not the report.
  const asked = cut(one.split(/\s*---\s*technical details/i)[0], 160);
  const raw = item.work?.ship?.pr?.note ?? null;
  const note = raw ? tidyFixNote(raw) : null;
  const done = note?.change ?? item.work?.didLine ?? null;
  return {
    asked,
    done: done ? cut(done, 220) : null,
    next: note?.next ? cut(note.next, 220) : null,
  };
}
