import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";
import { getProjectCore } from "@/db/queries/projects";
import { ProjectWatch } from "@/components/projects/ProjectWatch";

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
  const project = await getProjectCore(userId, id);
  if (!project) notFound();

  return (
    <div className="app-page mx-auto max-w-2xl space-y-4">
      <Link
        href={`/projects/${id}`}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {project.name}
      </Link>
      <h1 className="ui-page-title">Watch it work</h1>
      <ProjectWatch
        projectId={id}
        profileHref={`/projects/${id}`}
        runId={run && isValidUuid(run) ? run : undefined}
      />
    </div>
  );
}
