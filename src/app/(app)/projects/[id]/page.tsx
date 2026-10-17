import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getProjectDossier } from "@/db/queries/project-dossier";
import { getActiveProjectShare } from "@/db/queries/project-shares";
import { ProjectWorkspaceView } from "@/components/projects/ProjectWorkspaceView";
import { ProjectSharePanel } from "@/components/projects/ProjectSharePanel";
import { ROUTES } from "@/config/auth";
import { isInterviewAuto, isKickoffAuto } from "@/lib/integrations/orangecat-handoff-mode";
import { isSiteOperator } from "@/db/queries/users";
import { mayHoldPass } from "@/lib/feedback/pass-rule";
import { createOwnerPass } from "@/lib/feedback/owner-pass";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { reconcileSiteLiveUrl } from "@/lib/site-live-reconcile";
import { isFleetInfrastructureAllowed } from "@/lib/execution-access";
import { getGithubToken } from "@/lib/github-token";

import { FleetProjectRoute } from "@/components/projects/FleetProjectRoute";

export const metadata = { title: "Project" };

/** The one canonical project workspace, rendered from the dossier SSOT. */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kickoff?: string; interview?: string; joined?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect(ROUTES.SIGN_IN);

  const { id } = await params;
  const { kickoff, interview, joined } = await searchParams;
  const dossier = await getProjectDossier(session.user.id, id).catch(() => null);
  if (!dossier) notFound();

  // Featuring curates Loki's own landing page, so it is the instance
  // operator's call, not the project owner's — and the operator features other
  // tenants' work, so this is asked about the VIEWER rather than the dossier.
  const viewerIsSiteOperator = await isSiteOperator(session.user.id).catch(() => false);
  // Whether a link into the fleet's GitHub organisation would open for this
  // viewer, and whether they have anywhere of their own to take the code.
  const [viewerMayOpenOrgRepo, viewerHasGithub] = await Promise.all([
    isFleetInfrastructureAllowed(session.user.id).catch(() => false),
    getGithubToken(session.user.id)
      .then((t) => Boolean(t))
      .catch(() => false),
  ]);

  // The owner looking at a project with a repository but no live URL is the
  // moment to ask again whether its site went live since registration. Not
  // awaited: the page never waits on GitHub; the next load shows the answer.
  if (dossier.ownerId === session.user.id) {
    const up = await getUserProjectByEntityId(session.user.id, id).catch(() => null);
    if (up && !up.liveUrl && up.gitUrl) {
      void reconcileSiteLiveUrl(session.user.id, id, up.id).catch(() => undefined);
    }
  }

  const share =
    dossier.ownerId === session.user.id
      ? await getActiveProjectShare(session.user.id, id).catch(() => null)
      : null;
  const shareForClient = share
    ? {
        token: share.token,
        url: `/share/project/${share.token}`,
        audience: share.audience as "advisor" | "team" | "public",
        includeRoadmap: share.includeRoadmap,
        includeChangelog: share.includeChangelog,
        includeResources: share.includeResources,
        includeRepo: share.includeRepo,
        includeLiveUrl: share.includeLiveUrl,
      }
    : null;

  return (
    <>
      <FleetProjectRoute
        pathname={`/projects/${id}`}
        project={dossier.userProject?.name ?? dossier.detail.project.name}
      />
      <ProjectWorkspaceView
        dossier={dossier}
        autoKickoff={isKickoffAuto(kickoff)}
        autoInterview={isInterviewAuto(interview)}
        viewerIsSiteOperator={viewerIsSiteOperator}
        viewerMayOpenOrgRepo={viewerMayOpenOrgRepo}
        viewerHasGithub={viewerHasGithub}
        // The owner and every Builder get a pass: it is what makes a note on
        // the site build at once (lib/feedback/pass-rule.ts, mayHoldPass).
        ownerPass={mayHoldPass(dossier.viewerRole) ? createOwnerPass(id, session.user.id) : null}
        joined={joined === "1"}
        shareAction={
          !dossier.readonly ? (
            <ProjectSharePanel projectId={id} initialShare={shareForClient} />
          ) : undefined
        }
      />
    </>
  );
}
