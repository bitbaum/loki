import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getProjectDossier } from "@/db/queries/project-dossier";
import { getActiveProjectShare } from "@/db/queries/project-shares";
import { ProjectWorkspaceView } from "@/components/projects/ProjectWorkspaceView";
import { ProjectSharePanel } from "@/components/projects/ProjectSharePanel";
import { ROUTES } from "@/config/auth";
import { isInterviewAuto, isKickoffAuto } from "@/lib/integrations/orangecat-handoff-mode";

export const metadata = { title: "Project" };

/** The one canonical project workspace, rendered from the dossier SSOT. */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kickoff?: string; interview?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect(ROUTES.SIGN_IN);

  const { id } = await params;
  const { kickoff, interview } = await searchParams;
  const dossier = await getProjectDossier(session.user.id, id).catch(() => null);
  if (!dossier) notFound();

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
    <ProjectWorkspaceView
      dossier={dossier}
      autoKickoff={isKickoffAuto(kickoff)}
      autoInterview={isInterviewAuto(interview)}
      shareAction={
        !dossier.readonly ? (
          <ProjectSharePanel projectId={id} initialShare={shareForClient} />
        ) : undefined
      }
    />
  );
}
