"use client";

import { useRouter } from "next/navigation";
import { DescriptionEditor, StatusEditor } from "./ProjectInlineEditors";
import { HealthScoreBar } from "./HealthScore";
import { PROJECT_ATTR } from "@/config/project-attrs";
import { setAttr } from "@/lib/api/attrs";
import { patchJson, throwApiError } from "@/lib/api/fetch";
import type { ProjectHealth } from "@/lib/project-health";

/** Full, editable metadata. Nothing is clipped while the person is editing. */
export function ProjectIdentitySettings({
  projectId,
  userProjectId,
  description,
  status,
  health,
  readonly,
}: {
  projectId: string;
  userProjectId: string | null;
  description: string | null;
  status: string | null;
  health: ProjectHealth;
  readonly: boolean;
}) {
  const router = useRouter();
  return (
    <section className="ui-project-detail-block" aria-labelledby="project-description-title">
      {/* No Name field: the project is renamed where its name stands, in the
          header (ProjectWorkspaceHeader) — two editors for one name was one
          too many. */}
      <h2 id="project-description-title" className="ui-project-section-title">
        About it
      </h2>
      <DescriptionEditor
        value={description}
        editable={!readonly}
        size="full"
        onSave={async (next) => {
          const response = await patchJson(`/api/projects/${projectId}`, { description: next });
          if (!response.ok) await throwApiError(response, "Could not save description");
          router.refresh();
        }}
      />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <StatusEditor
          value={status}
          editable={!readonly}
          onSave={async (next) => {
            const response = await setAttr(`/api/projects/${projectId}`, PROJECT_ATTR.STATUS, next);
            if (!response.ok) throw new Error("Could not save stage");
            router.refresh();
          }}
        />
        <HealthScoreBar
          health={health}
          interactive
          projectId={readonly ? undefined : projectId}
          userProjectId={userProjectId}
          brief={description}
        />
      </div>
      <p className="mt-2 text-sm text-text-tertiary">
        How much of the profile is filled in — not a test of the site.
      </p>
    </section>
  );
}
