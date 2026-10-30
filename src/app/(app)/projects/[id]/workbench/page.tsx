import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { ROUTES } from "@/config/auth";
import { WORKBENCH_PANE_PARAM } from "@/config/workbench";
import { getProjectDossier } from "@/db/queries/project-dossier";
import { createOwnerPass } from "@/lib/feedback/owner-pass";
import { mayHoldPass } from "@/lib/feedback/pass-rule";
import { isPreviewDir } from "@/lib/previews/root";
import { isRuntimeAvailable } from "@/lib/runtime";
import { paneFromParam } from "@/lib/workbench/layout";
import { projectTitle } from "@/lib/project-display";
import { FleetProjectRoute } from "@/components/projects/FleetProjectRoute";
import { getProjectLinks } from "@/components/projects/project-detail-types";
import { WorkbenchView } from "@/components/workbench/WorkbenchView";
import type { WorkbenchSite } from "@/components/workbench/workbench-types";
import { ownerSiteUrl } from "../../../../../../widget/owner-pass";

export const metadata: Metadata = { title: "Workbench" };

/**
 * One project, side by side: its session and Loki as columns, the site in
 * its own window. `?pane=` makes this window one pane (popped out, or on
 * the other screen). The dossier is the same SSOT the project page reads;
 * the owner's pass is minted the same way, for the same people.
 */
export default async function ProjectWorkbenchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect(ROUTES.SIGN_IN);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const dossier = await getProjectDossier(session.user.id, id).catch(() => null);
  if (!dossier) notFound();

  const { detail, userProject } = dossier;
  const workspaceKey = userProject?.name ?? detail.project.name;
  const links = getProjectLinks(
    detail.attrs,
    userProject?.gitUrl ?? detail.project.gitUrl,
    userProject?.liveUrl,
  );
  const pass = mayHoldPass(dossier.viewerRole) ? createOwnerPass(id, session.user.id) : null;
  const site: WorkbenchSite | null = links.prodUrl
    ? {
        url: links.prodUrl,
        ownerUrl: pass ? ownerSiteUrl(links.prodUrl, pass) : null,
        kind: isPreviewDir(userProject?.dirPath) ? "preview" : "live",
      }
    : null;
  const name = projectTitle(userProject ?? detail.project);

  return (
    <>
      <FleetProjectRoute pathname={`/projects/${id}/workbench`} project={workspaceKey} />
      <div className="app-page app-page-compact app-viewport-pane flex flex-col">
        <Suspense fallback={<div className="ui-empty-page text-sm text-text-muted">Loading…</div>}>
          <WorkbenchView
            projectId={id}
            projectName={name}
            workspaceKey={workspaceKey}
            local={isRuntimeAvailable()}
            site={site}
            solo={paneFromParam(query[WORKBENCH_PANE_PARAM])}
          />
        </Suspense>
      </div>
    </>
  );
}
