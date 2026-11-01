"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Play } from "lucide-react";
import { DispatchedNote, useProjectDispatch } from "@/components/projects/ProjectActionButtons";
import type { MissionContinueOffer } from "@/lib/missions/continue-offer";

/**
 * The sole user-approved action on the Mission detail page.
 * No parallel mutation endpoint: the existing project dispatch API performs
 * capability checks, provider selection, gating and orchestration recording.
 */
export function MissionContinueAction({
  projectId,
  workspaceKey,
  offer,
}: {
  projectId: string;
  workspaceKey: string;
  offer: MissionContinueOffer;
}) {
  const router = useRouter();
  const { state, dispatch } = useProjectDispatch(projectId);

  if (offer.type === "read_only") {
    return (
      <p className="text-sm text-text-secondary">
        View-only project. Ask a project builder or owner to start work.
      </p>
    );
  }

  if (offer.type === "watch") {
    const label =
      offer.reason === "needs_you"
        ? "This run needs your input"
        : offer.reason === "stalled"
          ? "Review the stalled run before retrying"
          : offer.reason === "queued"
            ? "The mission is queued"
            : "An agent is working";
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">{label}</p>
        <Link
          href={`/projects/${projectId}/watch`}
          className="ui-btn-secondary inline-flex min-h-11 items-center gap-2 px-4"
        >
          View progress <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    );
  }

  if (offer.type === "setup") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {offer.reason === "no_repo"
            ? "Connect or provision the project's repository before starting a run."
            : "Add a project brief or roadmap before sending an agent."}
        </p>
        <Link
          href={`/projects/${projectId}${offer.reason === "no_brief" ? "#plan" : "#now"}`}
          className="ui-btn-secondary inline-flex min-h-11 items-center gap-2 px-4"
        >
          Complete setup <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    );
  }

  if (state.phase === "done") {
    return <DispatchedNote workspaceKey={workspaceKey} />;
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <button
        type="button"
        onClick={async () => {
          if (await dispatch(offer.kind)) router.refresh();
        }}
        disabled={state.phase === "sending"}
        className="ui-btn-primary inline-flex min-h-12 items-center gap-2 px-6 text-base"
      >
        {state.phase === "sending" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Play className="h-4 w-4" aria-hidden />
        )}
        {state.phase === "sending"
          ? "Sending to the runner…"
          : offer.kind === "next_step"
            ? "Continue mission"
            : "Start mission"}
      </button>
      {state.phase === "error" && (
        <p role="alert" className="ui-error text-sm">
          {state.message}
        </p>
      )}
    </div>
  );
}
