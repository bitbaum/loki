import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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

  return (
    <div className="app-page mx-auto max-w-2xl space-y-4">
      <FleetProjectRoute
        pathname={`/projects/${id}/watch`}
        project={registered?.name ?? project.name}
      />
      <Link
        href={`/projects/${id}`}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {project.name}
      </Link>
      <h1 className="ui-page-title">Watch it work</h1>
      {preview && (
        <PreviewShareCard projectId={id} name={registered?.name ?? project.name} {...preview} />
      )}
      <ProjectWatch
        key={`${id}:${run ?? "latest"}`}
        projectId={id}
        profileHref={`/projects/${id}`}
        runId={run && isValidUuid(run) ? run : undefined}
      />
    </div>
  );
}
