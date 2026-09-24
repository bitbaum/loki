/**
 * The interview — what Loki asks the owner before it builds anything.
 *
 * A project that arrives from OrangeCat's "Build it with Loki" button carries a
 * title, a one-line public description, and nothing else. That is enough to
 * CREATE a project and not remotely enough to BUILD one: the kickoff would
 * extract a profile from one sentence, invent milestones from the same
 * sentence, and put an agent to work on a brief that never said who the
 * customer is or what finished looks like. Everything downstream is a function
 * of that text, so thin text produces a thin everything — `isThinBrief` in
 * project-kickoff already names the failure, it just had nothing to do about it.
 *
 * The one person who knows the answers is sitting right there. So ask them.
 *
 * This module is the SSOT for WHICH questions are worth the owner's time and in
 * what order. It is deliberately pure — no database, no model — so the same
 * plan drives the API, the UI and the tests, and so a question can never be
 * asked about a field that is already answered.
 *
 * The model's role is to rephrase these questions in terms of the specific
 * project (see project-interview-ai.ts); it never decides WHAT is asked. When
 * it is unavailable the questions below are asked verbatim, and the interview
 * works exactly as well.
 */

import { PROJECT_ATTR } from "@/config/project-attrs";
import { hasAnswer } from "@/lib/project-display";

/** Longest answer we keep, matching the profile field limit in project-brief. */
export const INTERVIEW_ANSWER_MAX = 500;

/**
 * Nobody answers twelve questions. Five is the most that still reads as a
 * conversation rather than a form — which is the whole point, since a form is
 * exactly what "no forms" (project-brief) was built to avoid.
 */
export const MAX_INTERVIEW_QUESTIONS = 5;

export type InterviewFieldId =
  | typeof PROJECT_ATTR.CUSTOMERS
  | typeof PROJECT_ATTR.PROBLEM
  | typeof PROJECT_ATTR.SOLUTION
  | typeof PROJECT_ATTR.STACK
  | typeof PROJECT_ATTR.DEFINITION_OF_DONE;

export interface InterviewField {
  /** The profile attribute this question fills. Answers are stored verbatim. */
  id: InterviewFieldId;
  /** Asked as-is when the model cannot tailor it. Must stand alone. */
  question: string;
  /** Shown under the input — what a good answer looks like, not what to write. */
  hint: string;
  /**
   * Essential fields are the ones an agent builds the WRONG THING without.
   * Only these decide whether an interview is offered at all; the rest ride
   * along because the person is already answering questions.
   */
  essential: boolean;
}

/**
 * Ordered: who it is for, what hurts, what we do about it, what constrains the
 * build, what finished means. Each question answers the previous one's "for
 * whom?" — asking them out of order makes the owner re-derive context they
 * just gave.
 *
 * Mission and vision are deliberately absent. They are derivable from these
 * answers (the kickoff's profile step extracts them from the enriched brief),
 * and asking someone to state a mission before they have said who their
 * customer is produces a slogan, not context.
 */
export const INTERVIEW_FIELDS: readonly InterviewField[] = [
  {
    id: PROJECT_ATTR.CUSTOMERS,
    question: "Who is this for, and who pays for it?",
    hint: "The specific people or businesses — not “everyone”.",
    essential: true,
  },
  {
    id: PROJECT_ATTR.PROBLEM,
    question: "What do they do today instead, and what is bad about it?",
    hint: "The concrete pain, in their words if you have them.",
    essential: true,
  },
  {
    id: PROJECT_ATTR.SOLUTION,
    question: "What does this actually do for them?",
    hint: "The thing they get. Features only if they change the answer.",
    essential: true,
  },
  {
    id: PROJECT_ATTR.STACK,
    question: "Anything the build must use, or must avoid?",
    hint: "Languages, hosting, an existing system it has to fit. “No preference” is a real answer.",
    essential: false,
  },
  {
    id: PROJECT_ATTR.DEFINITION_OF_DONE,
    question: "What has to be true for the first version to be worth shipping?",
    hint: "Something you could check — a page that loads, a payment that clears.",
    essential: false,
  },
] as const;

export type InterviewInput = {
  /** The project's current attributes, keyed as stored. */
  attrs: Record<string, string | null | undefined>;
};

/**
 * The questions this project still needs answered, in order, capped.
 *
 * `hasAnswer`, not truthiness — the same predicate the kickoff planner and the
 * health check use. A field the extractor filled with "Unknown" is a field
 * nobody has answered, and it is exactly the field worth asking about.
 */
export function planInterview(input: InterviewInput): InterviewField[] {
  return INTERVIEW_FIELDS.filter((field) => !hasAnswer(input.attrs[field.id] ?? undefined)).slice(
    0,
    MAX_INTERVIEW_QUESTIONS,
  );
}

/**
 * Is there enough missing that asking is worth interrupting for?
 *
 * Only essential gaps count. A project with mission, problem and solution
 * written down does not get stopped on its way to work because nobody has
 * stated a preferred stack — that question rides along when the interview is
 * already happening, and is never a reason to start one.
 */
export function needsInterview(input: InterviewInput): boolean {
  return INTERVIEW_FIELDS.some(
    (field) => field.essential && !hasAnswer(input.attrs[field.id] ?? undefined),
  );
}

/** Raw answers as the UI collects them: field id → what the owner typed. */
export type InterviewAnswers = Partial<Record<InterviewFieldId, string>>;

/**
 * The fields whose answer is longer than we keep — named, so the cut is never
 * silent.
 *
 * Clamping rather than rejecting is deliberate (#799, "no dead ends"): an owner
 * who wrote too much should not be stopped at the last question. But a clamp
 * nobody hears about is data loss with good manners. On Skif, 2026-09-24, five
 * answers saved through this route were each cut to exactly 500 characters
 * mid-sentence, and those clipped fields are what briefs the build agent. The
 * route now says which fields it cut, so a caller can shorten and re-save.
 */
export function clampedAnswerFields(answers: InterviewAnswers): InterviewFieldId[] {
  return INTERVIEW_FIELDS.filter((field) => {
    const raw = answers[field.id];
    return typeof raw === "string" && raw.trim().length > INTERVIEW_ANSWER_MAX;
  }).map((field) => field.id);
}

/**
 * Answers worth storing, trimmed and clamped.
 *
 * Skipped questions arrive absent; a question the owner answered with "n/a" or
 * "dunno" arrives present and empty of content. Both must end up the same way —
 * as no attribute at all — because a stored "n/a" is truthy, satisfies every
 * "is this filled?" check downstream, and briefs an agent with "CUSTOMERS: n/a".
 * That is the exact bug `hasAnswer` was written for, and it does not stop being
 * a bug because a human typed it instead of a model.
 */
export function usableAnswers(answers: InterviewAnswers): InterviewAnswers {
  const out: InterviewAnswers = {};
  for (const field of INTERVIEW_FIELDS) {
    const raw = answers[field.id];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().slice(0, INTERVIEW_ANSWER_MAX);
    if (!hasAnswer(trimmed)) continue;
    out[field.id] = trimmed;
  }
  return out;
}

/**
 * The interview rendered as prose, appended to the project's description.
 *
 * The attributes alone are not enough. The description is what the profile
 * extractor reads to derive mission/vision, what the roadmap step decomposes
 * into milestones, what the dispatch prompt carries, and what RAG indexes — so
 * an answer that lives only in an attribute reaches some of those and not the
 * rest. Writing it into the brief as well means every path that briefs an agent
 * sees the same words the owner typed. Headed, so a later reader can tell which
 * parts of the brief came from a person and which came from OrangeCat.
 */
export function interviewBrief(answers: InterviewAnswers): string {
  const usable = usableAnswers(answers);
  const lines = INTERVIEW_FIELDS.flatMap((field) => {
    const value = usable[field.id];
    return value ? [`${field.question}\n${value}`] : [];
  });
  return lines.length > 0 ? `From the owner:\n\n${lines.join("\n\n")}` : "";
}

/** Marker for the appended block, so a second interview replaces it rather than stacking. */
const BRIEF_HEADING = "From the owner:";

/**
 * The project's new description: what it already said, plus the interview.
 *
 * Re-running the interview must not stack a second copy — the owner would be
 * reading their own answers twice and every extraction downstream would weight
 * them twice. The previous block is cut at its heading and replaced.
 */
export function mergeInterviewIntoDescription(
  description: string | null | undefined,
  answers: InterviewAnswers,
): string {
  const block = interviewBrief(answers);
  const index = (description ?? "").indexOf(BRIEF_HEADING);
  const base = (index >= 0 ? (description ?? "").slice(0, index) : (description ?? "")).trim();
  if (!block) return base;
  return base ? `${base}\n\n${block}` : block;
}
