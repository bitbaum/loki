/**
 * A thumbs-down on a Loki answer, written as a feedback report.
 *
 * The report has to stand on its own in the /feedback inbox, read by an
 * operator — and dispatched to an agent — who never saw the conversation. So
 * it carries the person's own words first (what was wrong), then the question
 * and the answer it is about, each clipped so the whole stays inside the
 * suggestion column's 2000-character budget. Pure; pinned by
 * scripts/test/loki-answer-report.ts.
 */

/** The ingest's own cap on a suggestion (api/feedback FeedbackBody). */
export const ANSWER_REPORT_MAX_CHARS = 2000;
const NOTE_MAX = 500;
const QUESTION_MAX = 400;

/** The page the report is filed against — the chat itself. */
export const ANSWER_REPORT_PAGE = "/loki";

export function buildAnswerReport({
  note,
  question,
  answer,
}: {
  note?: string | null;
  question?: string | null;
  answer: string;
}): string {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  const said = note?.trim();
  const head = said
    ? `Bad answer in Loki chat: ${clip(said, NOTE_MAX)}`
    : "Bad answer in Loki chat (no reason given).";
  const q = question?.trim() ? `\n\nQuestion:\n${clip(question.trim(), QUESTION_MAX)}` : "";
  const prefix = `${head}${q}\n\nAnswer:\n`;
  return prefix + clip(answer.trim(), Math.max(80, ANSWER_REPORT_MAX_CHARS - prefix.length));
}
