import { Suspense, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
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
        {/* One page, three questions, in the order an operator asks them.

            This page used to stack eleven cards of equal weight — alerts,
            host stats, revenue, the doctor, the auto-continue switch, the
            jobs, memory, failures, the audit log and a reading queue of
            ideas — so "is the machine all right?" meant reading all of
            them. The same treatment /today and /feedback got: the answer
            on top, what runs by itself next, and the record behind one
            tap. The cards are unchanged; only their place is. */}
        <SystemSection
          title="Is it healthy?"
          hint="Alarms first, then the box, then what failed lately."
        >
          {/* The builder's alarms live here, in full; /today links them in one line. */}
          <Suspense fallback={<CardSkeleton />}>
            <SystemAlertsCard />
          </Suspense>
          <SystemStats />
          {/* Directly under the host stats: when disk/RAM are tight, the next
              question is always "can I upgrade yet?" */}
          <HetznerCapacityCard />
          <FleetDoctorCard />
          <Suspense fallback={<CardSkeleton />}>
            <RecentFailuresCard />
          </Suspense>
        </SystemSection>

        <SystemSection
          title="What runs on its own"
          hint="The switch that lets agents keep going, and every scheduled job."
        >
          <GlobalAutoContinueCard />
          <ScheduledJobsCard initialJobs={jobs} />
        </SystemSection>

        {/* Records, not decisions: closed by default, still in the DOM. */}
        <details className="ui-disclosure">
          <summary className="ui-disclosure-summary">
            <ChevronDown className="ui-disclosure-chevron" aria-hidden="true" />
            <span className="ui-section-label">Records &amp; ideas</span>
            <span className="text-micro text-text-muted">
              {isFounder ? "revenue · " : ""}memory · control log · proposals
            </span>
          </summary>
          <div className="ui-disclosure-body space-y-4">
            {isFounder && (
              <Suspense fallback={<CardSkeleton />}>
                <RevenueCard />
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

/** A titled group of cards: the question it answers, and one line on what is in it. */
function SystemSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <header>
        <h2 className="ui-section-label">{title}</h2>
        <p className="mt-0.5 text-xs text-text-tertiary">{hint}</p>
      </header>
      {children}
    </section>
  );
}
