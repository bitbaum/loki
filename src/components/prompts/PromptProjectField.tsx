"use client";

import { useState } from "react";
import Link from "next/link";
import { useFleetProject } from "@/hooks/use-fleet-project";
import type { Project } from "./types";

/**
 * The project a prompt dialog runs against: the person's pick, else the
 * prompt's own pinned project, else the one they were last working in
 * (useFleetProject — the same answer Home and Sessions use), else the only
 * one they have. Never a guess between several.
 */
export function usePromptProject(projects: Project[], pinnedId?: string | null) {
  const remembered = useFleetProject();
  const [picked, setPicked] = useState<string | null>(null);
  const fallback =
    (pinnedId && projects.some((p) => p.id === pinnedId) ? pinnedId : null) ??
    (remembered
      ? projects.find((p) => p.name.toLowerCase() === remembered.toLowerCase())?.id
      : undefined) ??
    (projects.length === 1 ? projects[0]!.id : "");
  const projectId = picked ?? fallback;
  const project = projects.find((p) => p.id === projectId) ?? null;
  return { project, projectId, setProjectId: setPicked };
}

/** The one project picker both prompt dialogs draw: projects by the name a
 *  person calls them, and a way out when there are none. */
export function PromptProjectField({
  id,
  projects,
  value,
  onChange,
  required,
  hint,
}: {
  id: string;
  projects: Project[];
  value: string;
  onChange: (id: string) => void;
  required: boolean;
  hint?: string;
}) {
  if (projects.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        You have no projects yet.{" "}
        <Link href="/projects?new=1" className="ui-link-muted">
          Add one
        </Link>{" "}
        to run this prompt in it.
      </p>
    );
  }
  return (
    <div>
      <label className="ui-prompt-field-label" htmlFor={id}>
        Project
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="ui-input">
        <option value="">{required ? "Pick a project" : "No project"}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1.5 text-sm text-text-secondary">{hint}</p>}
    </div>
  );
}
