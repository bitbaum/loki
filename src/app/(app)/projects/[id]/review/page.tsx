import { notFound } from "next/navigation";
import { requirePageUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";
import { getProjectCore } from "@/db/queries/projects";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { latestSiteReview, publicReview } from "@/db/queries/site-reviews";
import { InspectionWorkspace } from "@/components/inspection/InspectionWorkspace";

export const metadata = { title: "Review your project" };
export default async function ProjectReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePageUserId();
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  // A review can dispatch fixes, so this is the owner's surface, never a public share.
  const project = await getProjectCore(userId, id);
  if (!project) notFound();
  const [registered, review] = await Promise.all([
    getUserProjectByEntityId(userId, id),
    latestSiteReview(userId, id),
  ]);
  return (
    <div className="app-page mx-auto max-w-7xl">
      <InspectionWorkspace
        projectId={id}
        projectName={project.name}
        initialReview={review ? publicReview(review) : null}
        hasWebsite={!!registered?.liveUrl}
        hasCode={!!(registered?.gitUrl || registered?.dirPath || project.gitUrl)}
      />
    </div>
  );
}
