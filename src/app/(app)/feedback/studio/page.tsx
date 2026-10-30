import { PageLayout } from "@/components/ui/page-layout";
import { StudioRequests } from "@/components/studio/StudioRequests";
import { requirePageUserId } from "@/lib/session";
import { listStudioRequests } from "@/db/queries/studio-requests";
import { getUserProjects } from "@/db/queries/user-projects";
export const metadata = { title: "Bitbaum studio requests" };
export default async function StudioRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const userId = await requirePageUserId();
  // A notification links straight to one request (lib/studio/notify.ts);
  // the page used to open the newest one whatever the link said.
  const { request } = await searchParams;
  const [requests, projects] = await Promise.all([
    listStudioRequests(userId),
    getUserProjects(userId),
  ]);
  return (
    <PageLayout
      title="Studio requests"
      subtitle="Review briefs, builder applications and previews for your studio account."
      back={{ href: "/feedback", label: "Feedback" }}
      maxWidth="max-w-6xl"
    >
      <StudioRequests
        initialRequests={requests}
        initialId={requests.some((r) => r.id === request) ? request : undefined}
        projects={projects
          .filter((p) => p.entityProjectId)
          .map((p) => ({ id: p.entityProjectId!, name: p.name }))}
      />
    </PageLayout>
  );
}
