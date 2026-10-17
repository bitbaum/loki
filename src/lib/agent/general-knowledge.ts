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
import { userWords } from "@/lib/loki/chat-scope";

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
export function isGeneralQuestion(prompt: string): boolean {
  // The person's words, not the project context a scoped chat wraps them in.
  const message = userWords(prompt);
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

/**
 * Said beside the question when it is general, not only in the contract.
 *
 * Rule 11 sits at the end of the grounding contract, after rules 1 and 3 —
 * which say "every claim must cite a record" and "answer with exactly Not in
 * your data". On the live site (2026-10-17, after rule 11 shipped) Gemini Flash
 * still answered the Eiffel Tower and the GmbH question with the refusal: the
 * earlier, stricter rules won. The line next to the question is the last thing
 * the model reads before it answers.
 */
export const GENERAL_QUESTION_HINT =
  "(This is a general question, not one about the operator's records. Answer it directly and correctly from general knowledge — rule 11. Use the records only if they bear on it.)";

/** The question as the model reads it: with the hint when it is general. */
export function askedQuestion(prompt: string): string {
  if (!isGeneralQuestion(prompt)) return prompt;
  // Directly above the person's words, after any project context: the hint
  // works because it is the last thing the model reads before the question.
  const words = userWords(prompt);
  const before = prompt.slice(0, prompt.length - words.length);
  return `${before}${GENERAL_QUESTION_HINT}\n\n${words}`;
}

/** The prompt for the one retry when a general question was refused anyway. */
export const GENERAL_ANSWER_SYSTEM =
  "You are Loki, a helpful assistant. Answer the question directly and correctly from general knowledge, in a few plain sentences. Write for a person who may not be technical. Do not say that you lack data or records.";

/** Did the model answer with the refusal and little else? */
export function isBareRefusal(text: string, refusal: string): boolean {
  const plain = text.replace(/[*_`>#]/g, "").trim();
  return plain.length < refusal.length + 80 && plain.toLowerCase().includes(refusal.toLowerCase());
}
