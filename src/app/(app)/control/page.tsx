import { Suspense } from "react";
import { PageLayout } from "@/components/ui/page-layout";
import { ControlPanel } from "@/components/control/ControlPanel";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { listSharedProjects } from "@/db/queries/project-access";
import { getSessionUserId } from "@/lib/session";

export const metadata = { title: "Home" };

export default async function ControlPage() {
  const userId = await getSessionUserId();
  const sharedProjects = userId ? await listSharedProjects(userId).catch(() => []) : [];
  return (
    <PullToRefresh>
      {/* Subtitle dropped 2026-05-31 — "Live agent state, project readiness,
          and next actions" was meaningless preamble taking space the runner-
          status banner needs. Title alone is enough; the chip strip + banner
          below tell the user what's actually happening. */}
      <PageLayout title="Home">
        <Suspense fallback={null}>
          <ControlPanel sharedProjects={sharedProjects} />
        </Suspense>
      </PageLayout>
    </PullToRefresh>
  );
}
