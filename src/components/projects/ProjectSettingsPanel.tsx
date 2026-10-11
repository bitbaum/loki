"use client";

import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { ProjectCodeCustody } from "./ProjectCodeCustody";
import { ProjectProvision } from "./ProjectProvision";
import { ProjectTeardown } from "./ProjectTeardown";
import { SiteRetirePanel } from "./SiteRetirePanel";

export function ProjectSettingsPanel({
  projectId,
  projectName,
  hasRepo,
  repoUrl,
  hasLocalPath,
  liveUrl,
  codeKeptByLoki = false,
  hasGithub = false,
}: {
  projectId: string;
  projectName: string;
  hasRepo: boolean;
  repoUrl?: string | null;
  hasLocalPath: boolean;
  /** The public site, when this project has one. */
  liveUrl?: string | null;
  /** user_projects.code_custody === "loki": Loki made and keeps the code. */
  codeKeptByLoki?: boolean;
  /** The viewer has a GitHub account connected — where a handover goes. */
  hasGithub?: boolean;
}) {
  const router = useRouter();

  return (
    <details className="border-y border-border-subtle">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">
        <Settings className="h-4 w-4" aria-hidden="true" /> Project settings
      </summary>
      <div className="space-y-5 border-t border-border-subtle py-5">
        {!hasRepo && <ProjectProvision projectId={projectId} onReload={() => router.refresh()} />}
        {codeKeptByLoki && <ProjectCodeCustody projectId={projectId} hasGithub={hasGithub} />}
        {liveUrl && <SiteRetirePanel projectId={projectId} liveUrl={liveUrl} />}
        <ProjectTeardown
          hasSite={Boolean(liveUrl)}
          projectName={projectName}
          projectId={projectId}
          hasRepo={hasRepo}
          repoUrl={repoUrl}
          codeKeptByLoki={codeKeptByLoki}
          hasLocalPath={hasLocalPath}
          onDeleted={() => router.push("/projects")}
        />
      </div>
    </details>
  );
}
