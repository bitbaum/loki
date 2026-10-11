import { NOTE_NONE, tidyFixNote } from "@/lib/feedback/fix-note";
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
  /** How it benefits the people using the product — every change owes it. */
  helps: string | null;
  /** How the developer knows it works — the only evidence a change nobody
   *  can see on a page has. */
  proof: string | null;
  next: string | null;
  behindTheScenes: boolean;
  /** How it benefits us, the people who run the product. */
  us: string | null;
  /** NOTE_NONE when the developer checked and there are none. */
  downsides: string | null;
  costs: string | null;
  /** No downsides AND no extra cost — said as one clear line. */
  noTradeoffs: boolean;
  /** What a done change owed and did not say, in words for the card. */
  notStated: string[];
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
  const behind = note?.shows === "behind";
  // Behind the scenes, "what changed in the system" IS what was done.
  const done = (behind ? note?.detail : null) ?? note?.change ?? item.work?.didLine ?? null;
  return {
    asked,
    done: done ? cut(done, 220) : null,
    helps: note?.helps ? cut(note.helps, 200) : null,
    proof: behind && note?.proof ? cut(note.proof, 200) : null,
    next: note?.next ? cut(note.next, 220) : null,
    behindTheScenes: behind,
    us: note?.us ? cut(note.us, 200) : null,
    downsides: note?.downsides ? cut(note.downsides, 200) : null,
    costs: note?.costs ? cut(note.costs, 200) : null,
    noTradeoffs: note?.downsides === NOTE_NONE && note?.costs === NOTE_NONE,
    // Only once something was done — a report nobody has worked on owes
    // nothing yet.
    notStated: done
      ? [
          !note?.helps && "how it helps users",
          !note?.us && "how it benefits us",
          !note?.downsides && "downsides",
          !note?.costs && "costs",
        ].filter((w): w is string => !!w)
      : [],
  };
}
