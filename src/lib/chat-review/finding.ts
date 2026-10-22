import type { ChatReview, ChatTranscript } from "@bitbaum/chatkit";
import { REVIEW_FILE_BELOW_SCORE } from "@/config/chat-review";

/** The ingest's cap on a suggestion (api/feedback FeedbackBody). */
export const FINDING_MAX_CHARS = 2000;

/** A review becomes a finding when it scored under the bar or named any gap:
 *  a 4/5 with a dead end in it is still a dead end someone hit. */
export function isFinding(review: ChatReview): boolean {
  return review.score < REVIEW_FILE_BELOW_SCORE || review.gaps.length > 0;
}

/** Worst first: the lowest score, then the most gaps. */
export function byUrgency(a: ChatReview, b: ChatReview): number {
  return a.score - b.score || b.gaps.length - a.gaps.length;
}

const GAP_WORDS: Record<ChatReview["gaps"][number], string> = {
  dead_end: "a dead end",
  wrong_tool: "the wrong tool",
  no_web: "no web lookup",
  misread: "misread the question",
  vague: "vague",
  too_long: "too long",
  no_next_step: "no next step",
  format: "hard to read",
  tone: "wrong tone",
  wrong: "wrong",
  slow: "slow",
};

/**
 * The finding as it reads in the feedback inbox, by an operator — and an
 * agent — who never saw the conversation: the score and the gaps first, then
 * what the person wanted, what we could have given, what we gave, and the one
 * fix. The conversation and message ids close it so the transcript can be
 * found again. Always inside the ingest's 2000-character cap.
 */
export function findingText(review: ChatReview, transcript: ChatTranscript): string {
  const clip = (s: string, n: number) =>
    s.length > n ? `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…` : s;
  const gaps = review.gaps.length
    ? review.gaps.map((g) => GAP_WORDS[g] ?? g).join(", ")
    : "no gap named";
  const date = transcript.at.slice(0, 10);
  const tail = ` (conversation ${transcript.id}, message ${review.messageId}, ${date})`;
  const parts = [
    `Chat answer scored ${review.score}/5 — ${gaps}.`,
    `The person wanted: ${review.expected || "unclear"}.`,
    `We could have given: ${review.deliverable || "unclear"}.`,
    `We gave: ${review.delivered || "unclear"}.`,
    `Fix: ${review.fix || "unclear"}.`,
  ];
  const body = parts.join(" ");
  return clip(body, FINDING_MAX_CHARS - tail.length) + tail;
}
