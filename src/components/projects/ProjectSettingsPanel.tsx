"use client";

import { useRouter } from "next/navigation";
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
    <section className="ui-project-detail-block" aria-labelledby="project-advanced-title">
      <h2 id="project-advanced-title" className="ui-project-section-title">
        Advanced
      </h2>
      <div className="mt-4 space-y-5">
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
    </section>
  );
}
