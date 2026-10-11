import type { BuildSuggestion, BuildSuggestionKind } from "@/lib/build-suggestions/rank";

/**
 * One suggestion on /suggestions, whatever front of life it came from.
 *
 * The shape is the build row's (lib/build-suggestions/rank.ts) — label, the
 * fact behind it, and exactly one of: a prompt that dispatches into a project,
 * a prompt Loki answers, or a place to open. The kinds are the build row's plus
 * the life avenues in lib/suggestions/life.ts. Which avenue a kind belongs to
 * is config (config/suggestion-avenues.ts), never decided here.
 */
export type LifeSuggestionKind =
  "habit" | "renewal" | "reconnect" | "crew_review" | "crew_handover" | "goal_due" | "event_due";

export type SuggestionKind = BuildSuggestionKind | LifeSuggestionKind;

export type Suggestion = Omit<BuildSuggestion, "kind"> & { kind: SuggestionKind };

export const SUGGESTION_DECISION = {
  /** The person tapped "Do it" — Loki has the ask, or they went where it is done. */
  TAKEN: "taken",
  /** The person tapped "Not now" — it stays out of sight for a while. */
  DISMISSED: "dismissed",
} as const;
export type SuggestionDecision = (typeof SUGGESTION_DECISION)[keyof typeof SUGGESTION_DECISION];

/**
 * How long a decision keeps a suggestion off the board. Neither is forever:
 * the fact behind a suggestion is re-read on every load, so a dismissed
 * renewal that is still coming comes back when the window closes, and a taken
 * fix that the agent did not finish comes back sooner.
 */
export const TAKEN_HIDE_DAYS = 7;
export const DISMISSED_HIDE_DAYS = 30;

export type SuggestionDecisionRecord = {
  id: string;
  suggestionId: string;
  decision: SuggestionDecision;
  createdAt: string;
};
