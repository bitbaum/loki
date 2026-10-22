import { Suspense } from "react";
import { ChevronDown } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { SystemStats } from "@/components/system/SystemStats";
import { HetznerCapacityCard } from "@/components/system/HetznerCapacityCard";
import { RevenueCard } from "@/components/system/RevenueCard";
import { PlansCard } from "@/components/system/PlansCard";
import { PrivateBuildersCard } from "@/components/system/PrivateBuildersCard";
import { CapacityCard } from "@/components/system/CapacityCard";
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
  //
  // So is the machine. Host RAM/disk/uptime, the Hetzner capacity watch, the
  // doctor and "Recent telemetry" describe the ONE server every account runs
  // on, and debug_logs has no user column — every account's errors, sign-in
  // failures and cron counts ("6 users", "34 projects") were on every
  // account's System page until 2026-10-17. A tenant gets their own alarms,
  // jobs and records; the box is the operator's.
  const viewer = await getUserById(userId).catch(() => null);
  const isFounder = viewer?.isDefault === true;

  return (
    <PullToRefresh>
      <PageLayout title="System" maxWidth="max-w-2xl">
        {/* One page, read top to bottom in the order an operator asks:
            anything wrong (alarms, then — the founder's — the server), what
            runs by itself, and the records behind one tap. Each part is a
            plain heading over its content (SystemBlock); it was eleven
            bordered cards under three question headings, "Fleet Doctor" and
            "Global auto-continue" among them. */}
        <Suspense fallback={<CardSkeleton />}>
          <SystemAlertsCard />
        </Suspense>
        {isFounder && (
          <>
            <SystemStats />
            {/* Directly under the server: when disk/RAM are tight, the next
                question is always "can I upgrade yet?" */}
            <HetznerCapacityCard />
            <Suspense fallback={<CardSkeleton />}>
              <CapacityCard />
            </Suspense>
            <FleetDoctorCard />
            <Suspense fallback={<CardSkeleton />}>
              <RecentFailuresCard />
            </Suspense>
          </>
        )}

        <GlobalAutoContinueCard />
        <ScheduledJobsCard initialJobs={jobs} />

        {/* Records, not decisions: closed by default, still in the DOM. */}
        <details className="ui-sys-more">
          <summary>
            <span className="ui-section-heading">More records</span>
            <span className="ui-sys-more-hint">
              {isFounder ? "Revenue, plans, " : ""}memory, what Loki decided, ideas
            </span>
            <ChevronDown className="ui-sys-more-chevron" aria-hidden="true" />
          </summary>
          <div className="mt-4 flex flex-col gap-6">
            {isFounder && (
              <Suspense fallback={<CardSkeleton />}>
                <RevenueCard />
              </Suspense>
            )}
            {isFounder && (
              <Suspense fallback={<CardSkeleton />}>
                <PlansCard />
              </Suspense>
            )}
            {isFounder && (
              <Suspense fallback={<CardSkeleton />}>
                <PrivateBuildersCard />
              </Suspense>
            )}
            <Suspense fallback={<CardSkeleton />}>
              <MemorySummaryCard />
            </Suspense>
            <Suspense fallback={<CardSkeleton />}>
              <RecentControlAuditCard userId={userId} />
            </Suspense>
            {/* Last: a reading queue of ideas, not machine health. */}
            <Suspense fallback={<CardSkeleton />}>
              <FrontierProposalsCard userId={userId} />
            </Suspense>
          </div>
        </details>
        <AutoRefresh intervalMs={REFRESH_CADENCE.system} />
      </PageLayout>
    </PullToRefresh>
  );
}
