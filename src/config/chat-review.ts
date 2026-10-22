import { APP_URL } from "@/config/brand";

/**
 * The fleet chat-review loop — which products are in it, and the night's
 * budgets. SSOT: the cron (api/crons/review-chats), the judge and the filer
 * (lib/chat-review/) read this and nothing else.
 *
 * Every product's chat is `@bitbaum/chatkit`, and chatkit 0.14 carries the
 * contract both ways: thumbs under every answer (`AnswerFeedback`) and the
 * transcript a product exports for review (`ChatTranscript`). Each product
 * serves `GET /api/chat/review-export` behind the shared `CHAT_REVIEW_TOKEN`
 * (.github/workflows/share-chat-review-token.yml puts one value in every
 * app's env on the box). Loki fetches, judges and files — into its own
 * feedback inbox, on the Loki project whose repository is the product's, so
 * the autopilot night builds the fix like any other finding.
 * docs/architecture/chat-review.md tells the whole loop.
 */
export type ChatReviewProduct = {
  /** The product's own key, as its export names itself. */
  key: string;
  exportUrl: string;
  /** The GitHub repository the finding is filed against (`bitbaum/<name>`). */
  repo: `bitbaum/${string}`;
};

const EXPORT_PATH = "/api/chat/review-export";

export const CHAT_REVIEW_PRODUCTS: readonly ChatReviewProduct[] = [
  { key: "heidi", exportUrl: `https://heidi.orangecat.ch${EXPORT_PATH}`, repo: "bitbaum/heidi" },
  { key: "orangecat", exportUrl: `https://orangecat.ch${EXPORT_PATH}`, repo: "bitbaum/orangecat" },
  {
    key: "substrata",
    exportUrl: `https://substrata.orangecat.ch${EXPORT_PATH}`,
    repo: "bitbaum/substrata",
  },
  { key: "loki", exportUrl: `${APP_URL}${EXPORT_PATH}`, repo: "bitbaum/loki" },
];

/** Conversations read per product per night; the export's own cap is 50. */
export const REVIEW_MAX_TRANSCRIPTS_PER_PRODUCT = 30;
/** Findings filed per product per night — the worst first, the rest wait. */
export const REVIEW_MAX_FINDINGS_PER_PRODUCT = 8;
/** A review scoring under this (≤ 3), or naming any gap, is a finding. */
export const REVIEW_FILE_BELOW_SCORE = 4;

/** How far back the night looks: the day since the last run. */
export const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

/** What the export route accepts and serves (every product applies the same). */
export const REVIEW_EXPORT_LIMIT = 50;
export const REVIEW_EXPORT_MAX_TURNS = 30;
export const REVIEW_EXPORT_MAX_CHARS = 4000;
