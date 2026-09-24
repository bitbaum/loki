/**
 * Inline tests for the interview planner (lib/project-interview.ts).
 *
 * Why this is worth testing: everything the interview produces is written
 * straight into the profile that briefs an agent, with no model in between. So
 * the two failures that matter are silent ones — asking about a field somebody
 * already answered (which teaches the owner the questions are noise), and
 * storing a non-answer like "n/a", which is truthy and therefore satisfies
 * every "is this filled?" check downstream while saying nothing. Both are
 * invisible in the UI and expensive in the dispatch prompt.
 *
 * Pure: no database, no model, no env. Run: npx tsx scripts/test/project-interview.ts
 */
import { PROJECT_ATTR } from "@/config/project-attrs";
import {
  INTERVIEW_ANSWER_MAX,
  INTERVIEW_FIELDS,
  MAX_INTERVIEW_QUESTIONS,
  interviewBrief,
  mergeInterviewIntoDescription,
  needsInterview,
  planInterview,
  usableAnswers,
  clampedAnswerFields,
} from "@/lib/project-interview";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ── The plan ────────────────────────────────────────────────────────────────

const empty = planInterview({ attrs: {} });
assert(
  empty.length === INTERVIEW_FIELDS.length && empty.length <= MAX_INTERVIEW_QUESTIONS,
  "a project with no profile is asked every question, and never more than the cap",
);
assert(
  empty[0].id === PROJECT_ATTR.CUSTOMERS,
  "who it is for comes first — every later question is answered in terms of it",
);

const answered = planInterview({
  attrs: { [PROJECT_ATTR.CUSTOMERS]: "Swiss cafés with 2–10 staff" },
});
assert(
  !answered.some((field) => field.id === PROJECT_ATTR.CUSTOMERS),
  "a field with a real answer is not asked about again",
);

// The exact live failure `hasAnswer` exists for: the extractor fills fields it
// could not infer with "Unknown" rather than omitting them. That is precisely
// the field worth asking a human about, so it must NOT count as answered.
const placeholder = planInterview({
  attrs: {
    [PROJECT_ATTR.CUSTOMERS]: "Unknown",
    [PROJECT_ATTR.PROBLEM]: "  ",
    [PROJECT_ATTR.SOLUTION]: "n/a",
  },
});
assert(
  placeholder.length === INTERVIEW_FIELDS.length,
  "Unknown / blank / n/a are gaps, not answers — ask about all of them",
);

// ── Whether to interrupt at all ─────────────────────────────────────────────

assert(needsInterview({ attrs: {} }), "a blank profile needs the interview");
assert(
  !needsInterview({
    attrs: {
      [PROJECT_ATTR.CUSTOMERS]: "Swiss cafés",
      [PROJECT_ATTR.PROBLEM]: "Bookings arrive by WhatsApp and get lost",
      [PROJECT_ATTR.SOLUTION]: "One inbox that turns messages into bookings",
    },
  }),
  "the three essential fields answered means no interruption — a missing stack preference is not a reason to stop someone on their way to work",
);
assert(
  needsInterview({
    attrs: { [PROJECT_ATTR.STACK]: "Next.js", [PROJECT_ATTR.DEFINITION_OF_DONE]: "It deploys" },
  }),
  "optional fields answered do not substitute for the essential ones",
);

// ── What gets stored ────────────────────────────────────────────────────────

const usable = usableAnswers({
  [PROJECT_ATTR.CUSTOMERS]: "  Swiss cafés with 2–10 staff  ",
  [PROJECT_ATTR.PROBLEM]: "n/a",
  [PROJECT_ATTR.SOLUTION]: "",
  [PROJECT_ATTR.STACK]: "x".repeat(INTERVIEW_ANSWER_MAX + 50),
  // A key nobody was asked about. This route writes profile attributes, so a
  // hand-rolled POST must not be able to set an arbitrary one through it.
  mission: "smuggled in",
} as Record<string, string>);
assert(usable[PROJECT_ATTR.CUSTOMERS] === "Swiss cafés with 2–10 staff", "answers are trimmed");
assert(!(PROJECT_ATTR.PROBLEM in usable), "'n/a' is a skip wearing an answer's clothes");
assert(!(PROJECT_ATTR.SOLUTION in usable), "an empty answer is a skip");
assert(
  usable[PROJECT_ATTR.STACK]?.length === INTERVIEW_ANSWER_MAX,
  "a long answer is clamped, not rejected",
);
assert(!("mission" in usable), "only the fields the interview asks about can be written");

// A clamp is allowed; a SILENT clamp is not. Skif, 2026-09-24: five answers
// were each cut to exactly 500 characters mid-sentence, and the route said
// nothing — the build agent would have been briefed from half-sentences.
const clamped = clampedAnswerFields({
  [PROJECT_ATTR.CUSTOMERS]: "short and whole",
  [PROJECT_ATTR.STACK]: "x".repeat(INTERVIEW_ANSWER_MAX + 50),
  [PROJECT_ATTR.SOLUTION]: "y".repeat(INTERVIEW_ANSWER_MAX),
} as Record<string, string>);
assert(
  clamped.length === 1 && clamped[0] === PROJECT_ATTR.STACK,
  `the one answer that was cut is named, and only that one (got ${JSON.stringify(clamped)})`,
);
assert(
  clampedAnswerFields({ [PROJECT_ATTR.STACK]: `  ${"z".repeat(INTERVIEW_ANSWER_MAX)}  ` } as Record<
    string,
    string
  >).length === 0,
  "an answer exactly at the limit once trimmed is kept whole, so it is not reported as cut",
);

// ── The brief the answers become ────────────────────────────────────────────

const brief = interviewBrief({
  [PROJECT_ATTR.SOLUTION]: "One inbox that turns messages into bookings",
  [PROJECT_ATTR.CUSTOMERS]: "Swiss cafés",
});
assert(
  brief.indexOf("Swiss cafés") < brief.indexOf("One inbox"),
  "the brief reads in question order, not in the order the answers arrived",
);
assert(interviewBrief({}) === "", "a fully skipped interview writes nothing");

const base = "Booking help for cafés. CHF 100.";
const once = mergeInterviewIntoDescription(base, { [PROJECT_ATTR.CUSTOMERS]: "Swiss cafés" });
assert(once.startsWith(base), "the public description is kept, not replaced");
assert(once.includes("Swiss cafés"), "the owner's words are appended to the brief");

// Re-running the interview must not stack a second copy: the owner would read
// their own answers twice and every extraction downstream would weight them twice.
const twice = mergeInterviewIntoDescription(once, {
  [PROJECT_ATTR.CUSTOMERS]: "Zurich cafés only",
});
assert(!twice.includes("Swiss cafés"), "a re-run replaces the previous block");
assert(twice.includes("Zurich cafés only"), "a re-run stores the new answer");
assert(
  twice.split("From the owner:").length === 2,
  "there is exactly one owner block however many times the interview runs",
);
assert(
  mergeInterviewIntoDescription(once, {}) === base,
  "skipping everything on a re-run leaves the original description alone",
);
assert(
  mergeInterviewIntoDescription(null, { [PROJECT_ATTR.CUSTOMERS]: "Swiss cafés" }).startsWith(
    "From the owner:",
  ),
  "a project with no description at all still gets a brief",
);

console.log("✓ project interview");
