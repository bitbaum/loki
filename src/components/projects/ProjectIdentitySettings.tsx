"use client";

import { useRouter } from "next/navigation";
import { DescriptionEditor, StatusEditor, ProjectNameEditor } from "./ProjectInlineEditors";
import { HealthScoreBar } from "./HealthScore";
import { PROJECT_ATTR } from "@/config/project-attrs";
import { setAttr } from "@/lib/api/attrs";
import { patchJson, throwApiError } from "@/lib/api/fetch";
import type { ProjectHealth } from "@/lib/project-health";

/** Full, editable metadata. Nothing is clipped while the person is editing. */
export function ProjectIdentitySettings({
  projectId,
  name,
  userProjectId,
  description,
  status,
  health,
  readonly,
}: {
  projectId: string;
  name: string;
  userProjectId: string | null;
  description: string | null;
  status: string | null;
  health: ProjectHealth;
  readonly: boolean;
}) {
  const router = useRouter();
  return (
    <section className="ui-project-detail-block" aria-labelledby="project-description-title">
      <h2 id="project-description-title" className="ui-project-section-title">
        Project details
      </h2>
      <div>
        <p className="text-sm font-medium text-text-secondary">Name</p>
        <ProjectNameEditor
          value={name}
          editable={!readonly}
          onSave={async (next) => {
            // The title, not the name: the name keys the project's history
            // (activity, runs, jobs), so a rename used to hide its past.
            const response = await patchJson(`/api/projects/${projectId}`, { title: next });
            if (!response.ok) await throwApiError(response, "Could not save name");
            router.refresh();
          }}
        />
      </div>
      <p className="text-sm font-medium text-text-secondary">Description</p>
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
        These checks describe the project profile, not a deployment or a running test suite.
      </p>
    </section>
  );
}
