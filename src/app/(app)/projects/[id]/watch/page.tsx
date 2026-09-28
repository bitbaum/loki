import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";
import { getProjectCore } from "@/db/queries/projects";
import { ProjectWatch } from "@/components/projects/ProjectWatch";

export const metadata = { title: "Watch it work" };

/** A project's latest run as a live, readable thread — see ProjectWatch. */
export default async function ProjectWatchPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePageUserId();
  const { id } = await params;
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
      <ProjectWatch projectId={id} profileHref={`/projects/${id}`} />
    </div>
  );
}
