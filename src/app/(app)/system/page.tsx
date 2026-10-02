import { Suspense } from "react";
import { PageLayout } from "@/components/ui/page-layout";
import { SystemStats } from "@/components/system/SystemStats";
import { HetznerCapacityCard } from "@/components/system/HetznerCapacityCard";
import { RevenueCard } from "@/components/system/RevenueCard";
import { ScheduledJobsCard } from "@/components/system/ScheduledJobsCard";
import { MemorySummaryCard } from "@/components/system/MemorySummaryCard";
import { RecentFailuresCard } from "@/components/system/RecentFailuresCard";
import { FleetDoctorCard } from "@/components/system/FleetDoctorCard";
import { FrontierProposalsCard } from "@/components/system/FrontierProposalsCard";
import { RecentControlAuditCard } from "@/components/system/RecentControlAuditCard";
import { GlobalAutoContinueCard } from "@/components/system/GlobalAutoContinueCard";
import { SystemAlertsCard } from "@/components/system/SystemAlertsCard";
import { CardSkeleton } from "@/components/ui/card";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { AutoRefresh } from "@/components/shared/AutoRefresh";
import { REFRESH_CADENCE } from "@/config/refresh";
import { requirePageUserId } from "@/lib/session";
import { getUserById } from "@/db/queries/users";
import { listCronJobsForUser } from "@/db/queries/cron-jobs";

export const metadata = { title: "System" };

export default async function SystemPage() {
  const userId = await requirePageUserId();
  // listCronJobsForUser is the only direct DB await on this route. When it
  // throws (DB connectivity blip, table not provisioned on a
  // fresh branch, etc.) the entire page crashes into the global error
  // boundary — caught live on loki.orangecat.ch/system showing
  // "Something went wrong" with the Server Components render error.
  // Defensive: fall back to an empty list so the rest of the page renders
  // (ScheduledJobsCard handles empty initialJobs cleanly). The error is
  // captured in console so postmortem still works.
  let jobs: Awaited<ReturnType<typeof listCronJobsForUser>> = [];
  try {
    jobs = await listCronJobsForUser(userId);
  } catch (err) {
    console.error("[system/page] listCronJobsForUser failed:", err);
  }

  // Platform revenue is founder-only — a regular tenant must never see
  // fleet-wide MRR. getUserById is defensive: a failure hides the card
  // rather than crashing the page.
  const viewer = await getUserById(userId).catch(() => null);
  const isFounder = viewer?.isDefault === true;

  return (
    <PullToRefresh>
      <PageLayout title="System">
        {/* The builder's alarms live here, in full; /today links them in one line. */}
        <Suspense fallback={<CardSkeleton />}>
          <SystemAlertsCard />
        </Suspense>
        <SystemStats />
        {/* Directly under the host stats: when disk/RAM are tight, the next
            question is always "can I upgrade yet?" */}
        <HetznerCapacityCard />
        {isFounder && (
          <Suspense fallback={<CardSkeleton />}>
            <RevenueCard />
          </Suspense>
        )}
        <FleetDoctorCard />
        <GlobalAutoContinueCard />
        <ScheduledJobsCard initialJobs={jobs} />
        <Suspense fallback={<CardSkeleton />}>
          <MemorySummaryCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <RecentFailuresCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <RecentControlAuditCard userId={userId} />
        </Suspense>
        {/* Last: a reading queue of ideas, not machine health. */}
        <Suspense fallback={<CardSkeleton />}>
          <FrontierProposalsCard userId={userId} />
        </Suspense>
        <AutoRefresh intervalMs={REFRESH_CADENCE.system} />
      </PageLayout>
    </PullToRefresh>
  );
}
