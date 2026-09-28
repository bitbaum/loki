"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DescriptionEditor, StatusEditor } from "./ProjectInlineEditors";
import { patchJson } from "@/lib/api/fetch";
import { setAttr } from "@/lib/api/attrs";
import { rememberFleetProject } from "@/lib/fleet-context";
import { HealthScoreBar } from "./HealthScore";
import type { ProjectHealth } from "@/lib/project-health";
import { PROJECT_ATTR } from "@/config/project-attrs";
import { cn } from "@/lib/utils";

export function ProjectWorkspaceHeader({
  projectId,
  userProjectId,
  name,
  workspaceKey,
  description,
  status,
  health,
  readonly,
}: {
  projectId: string;
  /** Catalog row id — the health worklist writes live_url through it. */
  userProjectId: string | null;
  name: string;
  workspaceKey: string;
  description: string | null;
  status: string | null;
  /** Derived, traceable score — not the retired hand-typed attrs.maturity. */
  health: ProjectHealth;
  readonly: boolean;
}) {
  const router = useRouter();
  const [currentDescription, setCurrentDescription] = useState(description);
  const [descExpanded, setDescExpanded] = useState(false);
  /** ~3 lines at this measure. Below it the clamp would hide nothing and the
   *  toggle would be a control that does not visibly do anything. */
  const isLongDescription = (currentDescription ?? "").length > 260;
  const [currentStatus, setCurrentStatus] = useState(status);

  // Re-seed from the server on every refresh. `useState(prop)` only reads its
  // argument on mount, so anything that wrote these through a different
  // control — the health worklist writes both — landed in the database, came
  // back down on router.refresh(), and was ignored here: the header went on
  // showing "+ stage" for a stage that was already set. A write you cannot see
  // land is indistinguishable from one that failed. Guarded render-time
  // adjustment (React's "adjusting state when a prop changes" pattern) instead
  // of effects, so the reseed lands in the same render pass.
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    setCurrentStatus(status);
  }
  const [prevDescription, setPrevDescription] = useState(description);
  if (description !== prevDescription) {
    setPrevDescription(description);
    setCurrentDescription(description);
  }

  useEffect(() => {
    rememberFleetProject(workspaceKey);
  }, [workspaceKey]);

  const refresh = () => router.refresh();

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <StatusEditor
          value={currentStatus}
          editable={!readonly}
          onSave={async (next) => {
            const response = await setAttr(`/api/projects/${projectId}`, PROJECT_ATTR.STATUS, next);
            if (!response.ok) throw new Error("Failed to save status");
            setCurrentStatus(next);
            refresh();
          }}
        />
        <HealthScoreBar
          health={health}
          interactive
          projectId={readonly ? undefined : projectId}
          userProjectId={userProjectId}
          brief={currentDescription}
        />
        {readonly && <span className="ui-tag ui-tag-neutral">Team project</span>}
      </div>

      <div className="mt-3">
        <h1 className="break-words text-2xl font-semibold leading-tight text-text-primary sm:text-3xl">
          {name}
        </h1>
      </div>

      {/* Clamped to three lines, expandable.
          A description is meant to say what this project IS. These have grown
          into whole briefs — loki's is 202 words naming every route,
          integration and monetisation rail — and printing all of it directly
          under the title pushes the page's actual controls below the fold.
          Three lines answers "what is this"; the rest is one click away, and
          the editor always opens the full text. Only offered when there is
          enough text to be worth hiding. */}
      {/* Height clamp, NOT line-clamp. `line-clamp-3` was tried first and did
          nothing on the live page: it clamps LINE BOXES of inline content, but
          the description renders inside DescriptionEditor's full-width
          <button>, which produces no line boxes in this wrapper. The computed
          display came back `flow-root` rather than `-webkit-box`, and the
          element measured 386px tall with a 386px scrollHeight — a clamp that
          reported itself as applied while clamping nothing.
          A max-height does not care what the child element is. */}
      <div
        className={cn(
          "mt-2 max-w-3xl text-sm leading-relaxed text-text-secondary sm:text-base",
          // Exactly three lines (3 × leading-relaxed 1.625em). A fixed 6rem cut
          // the fourth line through the middle of its letters on phones.
          !descExpanded && isLongDescription && "ui-clamp-3-lines",
        )}
      >
        <DescriptionEditor
          value={currentDescription}
          editable={!readonly}
          size="lead"
          onSave={async (next) => {
            const response = await patchJson(`/api/projects/${projectId}`, { description: next });
            const body = (await response.json()) as { ok?: boolean; error?: string };
            if (!response.ok || !body.ok)
              throw new Error(body.error ?? "Failed to save description");
            setCurrentDescription(next || null);
            refresh();
          }}
        />
      </div>
      {isLongDescription && (
        <button
          type="button"
          onClick={() => setDescExpanded((v) => !v)}
          aria-expanded={descExpanded}
          className="mt-1 text-xs font-medium text-text-tertiary transition-colors hover:text-text-secondary"
        >
          {descExpanded ? "Show less" : "Show full description"}
        </button>
      )}
    </div>
  );
}
