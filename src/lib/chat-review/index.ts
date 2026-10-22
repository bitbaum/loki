/**
 * The fleet chat-review loop, Loki's side (docs/architecture/chat-review.md):
 * fetch each product's day of conversations, hand them to an agent run on
 * the product's Loki project to judge every answer and file the gaps as
 * feedback. Config in config/chat-review.ts; run nightly by
 * api/crons/review-chats.
 */
export { fetchExport, type ChatReviewExport, type FetchExportResult } from "./fetch-export";
export { judgeInput } from "./judge";
export { composeChatReviewPrompt, REVIEWER_CONTACT, PROMPT_TRANSCRIPT_BUDGET } from "./prompt";
export { dispatchReview, type DispatchResult } from "./dispatch";
export { findingText, isFinding, byUrgency, FINDING_MAX_CHARS } from "./finding";
export { toTranscript, reviewSurface, stepsFrom, turnFailed } from "./transcripts";
export { requireChatReviewAuth } from "./auth";
