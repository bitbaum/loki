"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Plus } from "lucide-react";
import { ProjectBriefFill } from "./ProjectBriefFill";
import { ProjectDocSync } from "./ProjectDocSync";
import { ProjectResources } from "./ProjectResources";
import { BusinessPlanSection } from "./BusinessPlanSection";
import { AddAttrInline, AttrRow } from "./project-overview-helpers";
import { getProjectLinks, type ProjectResource } from "./project-detail-types";
import {
  PROJECT_CONTEXT_GROUPS,
  PROJECT_EDITOR_HIDDEN_KEYS,
  humanizeAttrKey,
} from "@/config/project-attrs";
import { answer, hasAnswer } from "@/lib/project-display";

// All three DERIVED from the field registry (config/project-attrs.ts), so the
// labels and placeholders a person edits are the same description the agent
// dossier and the AI profile-fill read. Market-lens attrs are in neither set,
// which is how they keep falling through to "Additional context" below.
const CONTEXT_GROUPS = PROJECT_CONTEXT_GROUPS;

const CONTEXT_KEYS = new Set<string>(
  CONTEXT_GROUPS.flatMap((group) => group.fields.map((field) => field.key)),
);
/** Known attrs that are NOT free-form context — rendered by dedicated UI elsewhere. */
const NON_CONTEXT_KEYS = PROJECT_EDITOR_HIDDEN_KEYS;

export function ProjectContextEditor({
  projectId,
  projectName,
  attrs,
  gitUrl,
  resources,
  readonly,
}: {
  projectId: string;
  projectName: string;
  attrs: Record<string, string>;
  gitUrl: string | null;
  resources: ProjectResource[];
  readonly: boolean;
}) {
  const router = useRouter();
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const editable = !readonly;
  const refresh = () => router.refresh();
  const fieldCount = CONTEXT_GROUPS.reduce((total, group) => total + group.fields.length, 0);
  const filledCount = CONTEXT_GROUPS.reduce(
    (total, group) => total + group.fields.filter((field) => hasAnswer(attrs[field.key])).length,
    0,
  );
  const extraAttrs = useMemo(
    () =>
      Object.entries(attrs).filter(
        ([key, value]) => value?.trim() && !CONTEXT_KEYS.has(key) && !NON_CONTEXT_KEYS.has(key),
      ),
    [attrs],
  );
  const hasRepo = getProjectLinks(attrs, gitUrl).repo !== null;

  return (
    <section className="ui-project-section" aria-labelledby="project-context-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-accent-text" aria-hidden="true" />
            <h2 id="project-context-title" className="text-lg font-semibold text-text-primary">
              Agent context
            </h2>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            Exact project context · {filledCount}/{fieldCount} core fields complete
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <ProjectBriefFill projectId={projectId} hasRepo={hasRepo} onReload={refresh} />
            <ProjectDocSync projectId={projectId} onReload={refresh} />
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-x-8 gap-y-7 lg:grid-cols-2">
        {CONTEXT_GROUPS.map((group) => (
          <section key={group.id} className={group.id === "build" ? "lg:col-span-2" : undefined}>
            <h3 className="ui-projects-section-label mb-1">{group.title}</h3>
            <div className="border-y border-border-subtle">
              {group.fields.map((field) => {
                const value = answer(attrs[field.key]);
                if (value) {
                  return (
                    <AttrRow
                      key={field.key}
                      label={field.label}
                      value={value}
                      projectId={projectId}
                      attrKey={field.key}
                      placeholder={field.placeholder}
                      editable={editable}
                      onReload={refresh}
                    />
                  );
                }
                if (!editable) return null;
                return (
                  <div key={field.key} className="border-b border-border-subtle py-2 last:border-0">
                    {addingKey === field.key ? (
                      <AddAttrInline
                        projectId={projectId}
                        presetKey={field.key}
                        presetPlaceholder={field.placeholder}
                        onSaved={() => {
                          setAddingKey(null);
                          refresh();
                        }}
                        onCancel={() => setAddingKey(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingKey(field.key)}
                        className="flex min-h-11 w-full items-center gap-2 text-left text-sm text-text-tertiary transition-colors hover:text-text-primary"
                      >
                        <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="font-medium">{field.label}</span>
                        <span className="hidden truncate text-text-muted sm:inline">
                          {field.placeholder}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {extraAttrs.length > 0 && (
        <details className="mt-6 border-y border-border-subtle">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-text-secondary">
            Additional context ({extraAttrs.length})
          </summary>
          <div className="border-t border-border-subtle pb-1">
            {extraAttrs.map(([key, value]) => (
              <AttrRow
                key={key}
                label={humanizeAttrKey(key)}
                value={value}
                projectId={projectId}
                attrKey={key}
                editable={editable}
                onReload={refresh}
              />
            ))}
          </div>
        </details>
      )}

      <div className="mt-7">
        <ProjectResources
          projectId={projectId}
          resources={resources}
          editable={editable}
          onReload={refresh}
        />
      </div>

      <div className="mt-7">
        <BusinessPlanSection
          attrs={attrs}
          projectId={projectId}
          projectName={projectName}
          editable={editable}
          onReload={refresh}
          showMarketLens={false}
        />
      </div>
    </section>
  );
}
