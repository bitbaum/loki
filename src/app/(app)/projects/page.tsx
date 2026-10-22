import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageLayout } from "@/components/ui/page-layout";
import { CardSkeleton } from "@/components/ui/card";
import {
  getProjects,
  getOrgEntityProjects,
  getProjectsLastDispatch,
  getProjectsRunNow,
} from "@/db/queries/projects";
import { listFeedbackSummary } from "@/db/queries/site-feedback";
import { ProjectsWorkspace } from "@/components/projects/ProjectsWorkspace";
import { NewProjectChooser } from "@/components/projects/NewProjectChooser";
import { FleetRegisterNote } from "@/components/projects/FleetRegisterNote";
import type { ProjectGridRow } from "@/components/projects/project-grid-row";
import { getPreviewCode } from "@/db/queries/preview-code";
import { requirePageUserId } from "@/lib/session";
import { isFleetInfrastructureAllowed } from "@/lib/execution-access";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { AutoRefresh } from "@/components/shared/AutoRefresh";
import { REFRESH_CADENCE } from "@/config/refresh";
import { isValidUuid } from "@/lib/utils";
import { getProjectDossierByProjectKey } from "@/db/queries/project-dossier";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    name?: string;
    description?: string;
    open?: string;
    project?: string;
  }>;
}) {
  const userId = await requirePageUserId();
  // Deep link from OrangeCat (and anywhere else): /projects?new=1&name=<prefill>
  // opens the create dialog immediately, optionally prefilled. `description`
  // carries what a "Build next" suggestion on /loki already knows about it.
  const params = await searchParams;
  // Canonicalize the retired drawer links. Browser history now records one real
  // project page instead of a list URL whose meaning depended on client state.
  if (params.open && isValidUuid(params.open)) redirect(`/projects/${params.open}`);
  const autoOpenCreate = params.new === "1";
  const prefillName = typeof params.name === "string" ? params.name : undefined;
  const prefillDescription =
    typeof params.description === "string" ? params.description.slice(0, 500) : undefined;
  const [ownProjects, orgProjects, lastDispatchByProject, feedbackSummary, runNowByProject] =
    await Promise.all([
      getProjects(userId),
      getOrgEntityProjects(userId),
      getProjectsLastDispatch(userId).catch(() => ({}) as Record<string, string>),
      listFeedbackSummary(userId).catch(() => []),
      getProjectsRunNow(userId).catch(() => ({})),
    ]);
  const projects: ProjectGridRow[] = [...ownProjects, ...orgProjects];
  // Notes nobody has looked at yet — "Needs you: 3 notes" on the row. The
  // ones already sent to an agent are the agent's, not the person's.
  const newNotesByProject = Object.fromEntries(
    feedbackSummary.map((s) => [s.projectId, s.newCount]),
  );
  if (params.project?.trim()) {
    const requested = params.project.trim();
    const matched = projects.find(
      (project) => project.name.toLocaleLowerCase() === requested.toLocaleLowerCase(),
    );
    if (matched) redirect(`/projects/${matched.id}`);
    const runtimeMatch = await getProjectDossierByProjectKey(userId, requested).catch(() => null);
    if (runtimeMatch) redirect(`/projects/${runtimeMatch.detail.project.id}`);
    redirect(`/projects?q=${encodeURIComponent(requested)}`);
  }

  // A preview is built on Loki's own computers and published on the fleet's
  // domain (lib/previews/create.ts), so only an account allowed on them is
  // offered one. Shown to everyone until 2026-10-17, where it was a whole form
  // that ended in a refusal — a dead end with a button on it.
  const [previewCode, canPreview] = await Promise.all([
    getPreviewCode(userId).catch(() => null),
    isFleetInfrastructureAllowed(userId).catch(() => false),
  ]);

  // The page's one primary action (design reset rule 5): a `+` that asks
  // "Build a site" or "Add an existing project". The empty list offers the
  // same choice as a plain button.
  const chooser = (variant: "page-action" | "button") => (
    <NewProjectChooser
      variant={variant}
      canBuildSite={canPreview}
      savedCode={previewCode ?? ""}
      // The deep link opens "Add" once, from the page's own `+`.
      autoOpen={variant === "page-action" && autoOpenCreate}
      initialName={prefillName}
      initialDescription={prefillDescription}
    />
  );

  return (
    <PullToRefresh>
      <PageLayout title="Projects" maxWidth="max-w-3xl" action={chooser("page-action")}>
        <Suspense fallback={<CardSkeleton />}>
          <ProjectsWorkspace
            projects={projects}
            lastDispatchByProject={lastDispatchByProject}
            newNotesByProject={newNotesByProject}
            runNowByProject={runNowByProject}
            emptyAction={chooser("button")}
          />
        </Suspense>
        <Suspense fallback={null}>
          <FleetRegisterNote userId={userId} />
        </Suspense>
        <AutoRefresh intervalMs={REFRESH_CADENCE.projects} />
      </PageLayout>
    </PullToRefresh>
  );
}
