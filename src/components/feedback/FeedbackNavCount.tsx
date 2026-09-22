"use client";

import { useFetch } from "@/hooks/use-fetch";
import type { ProjectFeedbackSummary } from "@/db/queries/site-feedback";
import { feedbackAwaitingTriage } from "@/lib/feedback/queue-counts";

/**
 * NEW-feedback count for the Feedback nav item — the in-app half of the
 * "you never learn feedback arrived" fix (push/Telegram is the away half).
 * Derived from the same summary endpoint the Control strip reads: a query,
 * not a second store. Renders nothing while loading or at zero so the nav
 * stays quiet unless something actually waits.
 */
export function FeedbackNavCount({ collapsed }: { collapsed: boolean }) {
  const { data } = useFetch<{ summary: ProjectFeedbackSummary[] }>("/api/feedback/summary", {
    intervalMs: 2 * 60_000,
  });
  const count = feedbackAwaitingTriage(data?.summary ?? []);
  if (count === 0) return null;
  if (collapsed) {
    return (
      <span
        className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent-primary"
        aria-label={`${count} new feedback`}
      />
    );
  }
  return (
    <span className="ml-auto ui-badge" aria-label={`${count} new feedback`}>
      {count}
    </span>
  );
}
