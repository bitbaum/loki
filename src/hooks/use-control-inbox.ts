"use client";

import { useFetch } from "@/hooks/use-fetch";
import type { ProjectFeedbackSummary } from "@/db/queries/site-feedback";
import type { WidgetCoverageItem } from "@/db/queries/widget-tokens";

/**
 * The Control inbox — every small thing the fleet noticed that a human has to
 * say yes to, read once and shared.
 *
 * ── Why this is a hook and not state inside ControlInbox ────────────────────
 * The Control hero exists to answer one question: *is anything waiting on me?*
 * It derived its answer from agents, run outcomes and projects awaiting input,
 * and from nothing else — so on 2026-09-20 it rendered "Idle — nothing queued"
 * while, roughly one screen below it, a panel titled "Needs you" carried the
 * badge 6. One page, one question, two answers, and the confident wrong one on
 * top.
 *
 * The count could not be lifted while it lived inside the panel that rendered
 * it, so it lives here and ControlPanel owns the single call: the hero reads
 * `total`, the panel receives the same object as a prop. One fetch, one truth.
 */
export type ControlInboxState = {
  summary: ProjectFeedbackSummary[];
  needsWidget: WidgetCoverageItem[];
  feedbackCount: number;
  /** Feedback awaiting triage plus sites missing the widget. */
  total: number;
  /** A request failed — `total` may be low, and silence is not an answer. */
  loadFailed: boolean;
  /** Still in flight. A failure that resolves in 300ms should not flash. */
  settling: boolean;
  refetch: () => void;
};

export function useControlInbox(): ControlInboxState {
  const feedback = useFetch<{ summary: ProjectFeedbackSummary[] }>("/api/feedback/summary");
  const widget = useFetch<{ coverage: WidgetCoverageItem[]; needsAttention: WidgetCoverageItem[] }>(
    "/api/feedback/widget-coverage",
  );

  const summary = feedback.data?.summary ?? [];
  const needsWidget = widget.data?.needsAttention ?? [];
  const feedbackCount = summary.reduce((n, s) => n + (s.newCount || s.openCount), 0);

  return {
    summary,
    needsWidget,
    feedbackCount,
    total: feedbackCount + needsWidget.length,
    // A fetch that failed yields `[]` exactly like a queue that is genuinely
    // empty. Conflating the two makes a failed request render as the confident
    // answer "no" — the one wrong answer this data must never give.
    loadFailed: Boolean(feedback.error || widget.error),
    settling: feedback.loading || widget.loading,
    refetch: () => {
      feedback.refetch();
      widget.refetch();
    },
  };
}
