"use client";

import { useState } from "react";
import { patchJson, postJson, throwApiError } from "@/lib/api/fetch";
import { FEEDBACK_STATUS, type FeedbackStatus } from "@/lib/constants/statuses";

/**
 * Row-level feedback actions, shared by the per-project inbox section and the
 * cross-project /feedback inbox. All routes are id-scoped, so the hook needs
 * no project context — the caller only supplies how to reload its list.
 */
export function useFeedbackActions(refetch: () => void) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, run: () => Promise<Response>, fallback: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await run();
      if (!res.ok) await throwApiError(res, fallback);
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Queue (or re-queue) the fix. `agent` switches provider in the same tap:
   * the route records it as the project's preference before dispatching, so
   * the next run does not go back to the agent that just hit a rate limit.
   */
  const dispatchFix = (id: string, opts: { note?: string; agent?: string } = {}) =>
    act(
      id,
      () =>
        postJson(`/api/feedback/${id}/dispatch`, {
          ...(opts.note ? { note: opts.note } : {}),
          ...(opts.agent ? { agent: opts.agent } : {}),
        }),
      "Could not queue the fix",
    );

  const setStatus = (id: string, status: FeedbackStatus) =>
    act(id, () => patchJson(`/api/feedback/${id}`, { status }), "Update failed");

  const resolve = (id: string) => setStatus(id, FEEDBACK_STATUS.RESOLVED);
  const archive = (id: string) => setStatus(id, FEEDBACK_STATUS.ARCHIVED);
  const reopen = (id: string) => setStatus(id, FEEDBACK_STATUS.NEW);

  const feature = (id: string, featured: boolean) =>
    act(id, () => patchJson(`/api/feedback/${id}`, { featured }), "Update failed");

  return {
    busyId,
    error,
    setError,
    act,
    dispatchFix,
    setStatus,
    resolve,
    archive,
    reopen,
    feature,
  };
}
