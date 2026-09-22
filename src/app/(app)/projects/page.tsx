import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageLayout } from "@/components/ui/page-layout";
import { CardSkeleton } from "@/components/ui/card";
import { getProjects, getOrgEntityProjects, getProjectsLastDispatch } from "@/db/queries/projects";
import { listFeedbackSummary } from "@/db/queries/site-feedback";
import { ProjectsWorkspace } from "@/components/projects/ProjectsWorkspace";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { FleetRegisterNote } from "@/components/projects/FleetRegisterNote";
import type { ProjectGridRow } from "@/components/projects/project-grid-row";
import { requirePageUserId } from "@/lib/session";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { AutoRefresh } from "@/components/shared/AutoRefresh";
import { REFRESH_CADENCE } from "@/config/refresh";
import { isValidUuid } from "@/lib/utils";
import { getProjectDossierByProjectKey } from "@/db/queries/project-dossier";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; name?: string; open?: string; project?: string }>;
}) {
  const userId = await requirePageUserId();
  // Deep link from OrangeCat (and anywhere else): /projects?new=1&name=<prefill>
  // opens the create dialog immediately, optionally prefilled.
  const params = await searchParams;
  // Canonicalize the retired drawer links. Browser history now records one real
  // project page instead of a list URL whose meaning depended on client state.
  if (params.open && isValidUuid(params.open)) redirect(`/projects/${params.open}`);
  const autoOpenCreate = params.new === "1";
  const prefillName = typeof params.name === "string" ? params.name : undefined;
  const [ownProjects, orgProjects, lastDispatchByProject, feedbackSummary] = await Promise.all([
    getProjects(userId),
    getOrgEntityProjects(userId),
    getProjectsLastDispatch(userId).catch(() => ({}) as Record<string, string>),
    listFeedbackSummary(userId).catch(() => []),
  ]);
  const projects: ProjectGridRow[] = [...ownProjects, ...orgProjects];
  const feedbackOpenByProject = Object.fromEntries(
    feedbackSummary.map((s) => [s.projectId, s.openCount]),
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

  return (
    <PullToRefresh>
      <PageLayout
        title="Projects"
        // Says what the order IS, because the order is the page's only real
        // product — everything about one project is better on that project's
        // page. The old line, "Decide what needs your attention now", promised
        // triage this page never did: it ranked by the alphabet, and it ranked
        // projects that already knew their next step ABOVE the ones that were
        // stuck. A page that names its sort can be trusted or argued with; one
        // that hides it just feels arbitrary.
        subtitle="Every project you run — flagged first, then most recently active."
        maxWidth="max-w-5xl"
        right={<NewProjectButton autoOpen={autoOpenCreate} initialName={prefillName} />}
      >
        <Suspense fallback={<CardSkeleton />}>
          <ProjectsWorkspace
            projects={projects}
            lastDispatchByProject={lastDispatchByProject}
            feedbackOpenByProject={feedbackOpenByProject}
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
