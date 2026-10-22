import { notFound } from "next/navigation";
import { PageLayout } from "@/components/ui/page-layout";
import { projectTitle } from "@/lib/project-display";
import { requirePageUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";
import { getProjectAccess } from "@/db/queries/project-access";
import { getProjectCore } from "@/db/queries/projects";
import { ProjectWatch } from "@/components/projects/ProjectWatch";

import { FleetProjectRoute } from "@/components/projects/FleetProjectRoute";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { PreviewShareCard } from "@/components/projects/PreviewShareCard";
import { beforeAfterUrl } from "@/config/preview-brief";
import { getProjectPreviewCode } from "@/db/queries/preview-code";
import { createOwnerPass, ownerSiteUrl } from "@/lib/feedback/owner-pass";
import { readPreviewSource } from "@/lib/previews/folder";
import { isPreviewDir } from "@/lib/previews/root";

export const metadata = { title: "Watch it work" };

/** A project's latest run as a live, readable thread — see ProjectWatch. */
export default async function ProjectWatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const userId = await requirePageUserId();
  const { id } = await params;
  const { run } = await searchParams;
  if (!isValidUuid(id)) notFound();
  const access = await getProjectAccess(userId, id);
  const executionUserId = access?.ownerUserId ?? userId;
  const project = await getProjectCore(executionUserId, id);
  if (!project) notFound();
  const registered = await getUserProjectByEntityId(executionUserId, id);
  // A preview is built to be shown to someone: put the link, the code and the
  // before-and-after tour right where the owner watches it being built. The
  // tour exists for a preview made from a live site (the folder says which).
  const isOwner = executionUserId === userId;
  const preview =
    isOwner && registered?.liveUrl && isPreviewDir(registered.dirPath)
      ? {
          previewUrl: registered.liveUrl,
          ownerUrl: ownerSiteUrl(registered.liveUrl, createOwnerPass(id, userId)),
          code: await getProjectPreviewCode({ userId, entityProjectId: id }).catch(() => null),
          tourUrl:
            registered.dirPath && (await readPreviewSource(registered.dirPath))
              ? beforeAfterUrl(registered.liveUrl)
              : null,
        }
      : null;

  const title = projectTitle(project);
  // One title (the page's), the project it belongs to as the way back — the
  // PageLayout every page uses, not a hand-rolled back link and h1.
  return (
    <PageLayout
      title="Watch it work"
      back={{ href: `/projects/${id}`, label: title }}
      maxWidth="max-w-2xl"
    >
      <FleetProjectRoute
        pathname={`/projects/${id}/watch`}
        project={registered?.name ?? project.name}
      />
      {preview && <PreviewShareCard projectId={id} name={title} {...preview} />}
      <ProjectWatch
        key={`${id}:${run ?? "latest"}`}
        projectId={id}
        profileHref={`/projects/${id}`}
        runId={run && isValidUuid(run) ? run : undefined}
      />
    </PageLayout>
  );
}
