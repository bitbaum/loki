"use client";

import { useFetch } from "@/hooks/use-fetch";
import { WORKBENCH_POLL_MS } from "@/config/workbench";
import { stateLine, type StateLine, type StateLineInput } from "@/lib/workbench/state-line";

/**
 * The project's build as one line, kept fresh: the sentence the Watch
 * track composes, a tone, and whether there is a run to watch at all.
 */
export function useRunState(projectId: string): StateLine & { hasRun: boolean } {
  const { data } = useFetch<StateLineInput>(`/api/projects/${projectId}/watch`, {
    intervalMs: WORKBENCH_POLL_MS,
  });
  return { ...stateLine(data), hasRun: Boolean(data?.run) };
}
