"use client";

import Link from "next/link";
import { useFetch } from "@/hooks/use-fetch";
import { WORKBENCH_POLL_MS } from "@/config/workbench";
import { stateLine, type StateLineInput } from "@/lib/workbench/state-line";
import { cn } from "@/lib/utils";

/**
 * The build as one line above the robot: a dot, the sentence the track
 * composes, and "Watch it work" for the whole story. Watch's card says the
 * same as a column of stages; on the workbench that column was a second
 * surface beside the robot, and a sentence is enough to feel in control.
 */
export function WorkbenchStateLine({ projectId }: { projectId: string }) {
  const { data } = useFetch<StateLineInput>(`/api/projects/${projectId}/watch`, {
    intervalMs: WORKBENCH_POLL_MS,
  });
  const line = stateLine(data);
  return (
    <p className="ui-workbench-state" role="status">
      <span className={cn("ui-dot", `ui-dot-${line.tone}`)} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{line.text}</span>
      {data?.run && (
        <Link
          href={`/projects/${encodeURIComponent(projectId)}/watch`}
          className="ui-link shrink-0"
        >
          Watch it work
        </Link>
      )}
    </p>
  );
}
