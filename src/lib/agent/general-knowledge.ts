/**
 * General questions get general answers.
 *
 * Asked "What year was the Eiffel Tower built?" and "What's the difference
 * between a sole proprietorship and a GmbH in Switzerland?" on the live site
 * (2026-10-17), Loki answered both with exactly "Not in your data." Two
 * things made that the only answer that could survive:
 *
 * 1. The contract's rule 3 — "if any part of the request has no supporting
 *    record, answer that part with exactly Not in your data" — reads to a
 *    small model as covering the whole world, not just the operator.
 * 2. The verifier runs closed-world: every capitalised word and every number
 *    in the answer must appear in a record. "Eiffel", "Paris" and "1889" do
 *    not, so the repair pass was asked to delete them, and the one answer
 *    with zero violations is the refusal. The repair is kept whenever it has
 *    fewer violations — so the checker itself turned a right answer into
 *    "Not in your data."
 *
 * The fix keeps the protection where it was built for — claims about the
 * operator ("Elena works at UZH") — and stops applying it to the world:
 *
 * - When the planner matched no subject (`broad`, or only the knowledge cues
 *   every general question is made of), the question is not about a named
 *   surface of the operator's records, so only the sentences that ARE
 *   about their records are verified: a sentence that cites a record, or that
 *   names something a record is about (a person, a project, a goal). Every
 *   other sentence is general knowledge and is not the verifier's business.
 * - When the planner did match a subject, nothing changes — the full
 *   closed-world check runs exactly as before.
 *
 * Pure: answer, facts and message in; the text the verifier should read out.
 */
import type { Fact } from "@bitbaum/ai-kit/grounding";
import { planRetrieval } from "@/lib/agent/plan";
import { PROJECT_CUES } from "@/lib/agent/cues";

/** Words that appear in record subjects but name no particular thing. */
const GENERIC = new Set([
  "chat",
  "thread",
  "feedback",
  "fleet",
  "status",
  "right",
  "working",
  "note",
  "project",
  "projects",
  "with",
  "from",
  "that",
  "this",
  "into",
  "about",
  "empty",
  "done",
  "open",
  "waiting",
  "running",
  "error",
  "errored",
  "failed",
  "succeeded",
  "build",
  "deploy",
  "update",
]);

const SENTENCE_SPLIT = /(?<=[.!?:\n])\s+/;
const CITATION = /[[【〔［][FD]\d+[\]】〕］]/;

/**
 * Did the question name no surface of the operator's records?
 *
 * Either nothing matched (`broad`), or only the knowledge cues did — and those
 * are the words every general question is made of ("what is", "how does",
 * "why", "explain"). The planner reads the operator's notes for them in case
 * they wrote about it; that does not make the question about them.
 */
export function isGeneralQuestion(message: string): boolean {
  const plan = planRetrieval(message);
  if (plan.broad) return true;
  // "Why did I decide…", "explain my architecture" — the knowledge cues again,
  // but about the operator's own decisions and work.
  if (FIRST_PERSON.test(message) || PROJECT_CUES.test(message)) return false;
  return plan.sources.every((s) => s === "knowledge" || BACKGROUND_SOURCES.has(s));
}

const FIRST_PERSON = /\b(i|i'm|i've|me|my|mine|we|we're|our|ours|us)\b/i;

/** The planner's always-on glance — present on every plan, a subject of none. */
const BACKGROUND_SOURCES = new Set<string>(["fleet_status", "projects"]);

/** The words that name the things the operator's records are about. */
export function recordNames(facts: Pick<Fact, "subject">[]): Set<string> {
  const names = new Set<string>();
  for (const f of facts) {
    for (const w of f.subject.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w)) names.add(w);
    }
  }
  return names;
}

function aboutRecords(sentence: string, names: Set<string>): boolean {
  if (CITATION.test(sentence)) return true;
  for (const w of sentence.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (names.has(w)) return true;
  }
  return false;
}

/**
 * The part of an answer the closed-world verifier should check.
 *
 * Returns the whole answer when the question named a subject, and only the
 * sentences about the operator's records when it did not. An empty string
 * means the answer is general knowledge throughout.
 */
export function operatorClaims(
  answer: string,
  facts: Pick<Fact, "subject">[],
  userMessage: string,
): string {
  if (!isGeneralQuestion(userMessage)) return answer;
  const names = recordNames(facts);
  return answer
    .split(SENTENCE_SPLIT)
    .filter((s) => aboutRecords(s, names))
    .join(" ");
}
