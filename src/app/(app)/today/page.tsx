import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { NAV } from "@/config/navigation";
import { CardSkeleton } from "@/components/ui/card";
import { Greeting } from "@/components/today/Greeting";
import { SummaryBar, SummaryBarSkeleton } from "@/components/today/SummaryBar";
import { ActionQueueCard } from "@/components/today/ActionQueueCard";
import { AlertsCard } from "@/components/today/AlertsCard";
import { GoalsDueCard } from "@/components/today/GoalsDueCard";
import { EventsDueCard } from "@/components/today/EventsDueCard";
import { CalendarCard } from "@/components/today/CalendarCard";
import { WeatherCard } from "@/components/today/WeatherCard";
import { CommitmentsCard } from "@/components/today/CommitmentsCard";
import { SubscriptionsCard } from "@/components/today/SubscriptionsCard";
import { LogConversationButton } from "@/components/today/LogConversationButton";
import { StickyNoteCard } from "@/components/today/StickyNoteCard";
import { HabitsCard } from "@/components/today/HabitsCard";
import { RecentRunsCard } from "@/components/today/RecentRunsCard";
import { FleetBriefCard } from "@/components/today/FleetBriefCard";
import { StuckGoalsCard } from "@/components/today/StuckGoalsCard";
import { LockedZoneBanner } from "@/components/today/LockedZoneBanner";
import { TodayWatch } from "@/components/today/TodayWatch";
import { LayoutGrid, ChevronDown } from "lucide-react";
import { DayPhaseDispatch } from "@/components/today/DayPhaseDispatch";
import { requirePageUserId, getCurrentUserName } from "@/lib/session";
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import { FIRST_RUN } from "@/lib/constants/today";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { AutoRefresh } from "@/components/shared/AutoRefresh";
import { REFRESH_CADENCE } from "@/config/refresh";

export const metadata = { title: "Today" };

/** Every card below streams in behind the same skeleton. Writing that out
 *  eleven times buried what this page is actually saying — which decisions come
 *  first — under its loading mechanics. */
const Streamed = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<CardSkeleton />}>{children}</Suspense>
);

/** The page's one row shape: a single column on a phone, two from md up, and
 *  a single full-width card when only one of the pair had anything to say.
 *  `alignTop` is for rows whose two cards differ in height. */
const CardRow = ({ children, alignTop = false }: { children: ReactNode; alignTop?: boolean }) => (
  <div className={`ui-today-row${alignTop ? " items-start" : ""}`}>{children}</div>
);

async function loadTodayInputs() {
  // Inline diagnostic — /today has been crashing in production with an
  // opaque "Server Components render" error that doesn't surface in the
  // client error.message or via onRequestError. Wrap each upstream call
  // in its own try/catch, log to debug_logs with the failure site, then
  // re-throw so the error boundary still fires. Remove this once the
  // root cause is fixed and stable.
  const { logDebug } = await import("@/db/queries/debug-logs");
  async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const err = e as Error;
      await logDebug({
        source: "today/page",
        level: "error",
        message: `step '${label}' threw: ${err.message ?? String(e)}`,
        meta: { stack: (err.stack ?? "").split("\n").slice(0, 12).join("\n") },
      }).catch(() => {});
      throw e;
    }
  }
  const [name, userId] = await Promise.all([
    step("getCurrentUserName", () => getCurrentUserName()),
    step("requirePageUserId", () => requirePageUserId()),
  ]);
  const [projects, orgProjects] = await Promise.all([
    step("getUserProjects", () => getUserProjects(userId)),
    step("getOrgProjects", () => getOrgProjects(userId)),
  ]);
  return { name, userId, projects, orgProjects };
}

export default async function TodayPage() {
  const { name, userId, projects, orgProjects } = await loadTodayInputs();
  const isFirstRun = projects.length === 0 && orgProjects.length === 0;
  return (
    <PullToRefresh>
      <div className="app-page max-w-4xl space-y-6">
        <div>
          <Greeting name={name} />
          {isFirstRun && (
            <div className="ui-callout-accent mt-4">
              <LayoutGrid className="mt-0.5 h-5 w-5 shrink-0 text-accent-text" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text-primary">{FIRST_RUN.title}</p>
                <p className="mt-0.5 text-sm text-text-secondary">{FIRST_RUN.body}</p>
                <Link
                  href={NAV.control.href}
                  className="mt-3 inline-flex items-center ui-tap gap-1.5 text-sm font-medium text-accent-text hover:opacity-80 transition-opacity"
                >
                  {FIRST_RUN.cta} →
                </Link>
              </div>
            </div>
          )}
          {!isFirstRun && (
            <>
              <Suspense
                fallback={
                  <div className="mt-2">
                    <SummaryBarSkeleton />
                  </div>
                }
              >
                <div className="mt-2">
                  <SummaryBar />
                </div>
              </Suspense>
              <div className="mt-3 ui-quick-actions-row ui-scroll-fade-right">
                <DayPhaseDispatch />
                <LogConversationButton />
              </div>
            </>
          )}
        </div>

        {!isFirstRun && (
          <>
            <Suspense fallback={null}>
              <LockedZoneBanner />
            </Suspense>

            {/* Loki's proactive read on the private zone — one thing to focus on,
          plus a totals strip across categories. Renders only when unlocked. */}
            <Streamed>
              <TodayWatch />
            </Streamed>

            {/* Decisions first — the only cards that ask the reader for
                something. On a 390px phone the ordering here is the difference
                between one thumb-scroll and four, so read-only recap must never
                climb above this block. */}
            <CardRow>
              <Streamed>
                <StickyNoteCard />
              </Streamed>
              <Streamed>
                <ActionQueueCard />
              </Streamed>
              <Streamed>
                <AlertsCard />
              </Streamed>
            </CardRow>

            {/* Today itself — the two cards that are only true right now. */}
            <CardRow>
              <CalendarCard />
              <WeatherCard />
            </CardRow>

            {/* Habits are a today action (check one off), so they stay out of
                the disclosure below with the read-only recap. */}
            <CardRow alignTop>
              <Streamed>
                <HabitsCard />
              </Streamed>
              <Streamed>
                <CommitmentsCard />
              </Streamed>
            </CardRow>

            {/*
              Everything below is recap or a summary of a page that already
              exists in the nav: goals (/goals), events (/events),
              subscriptions (/money), run history (/activity).

              This page rendered thirteen cards of equal weight, so answering
              "what needs me today?" meant scrolling past six summaries of
              things that did not. Collapsed by default it is still one tap
              away and still crawlable in the DOM — <details> renders its
              content either way — but the phone screen is spent on the
              decisions above instead.
            */}
            <details className="ui-disclosure">
              <summary className="ui-disclosure-summary">
                <ChevronDown className="ui-disclosure-chevron" aria-hidden="true" />
                <span className="ui-section-label">Recap &amp; reference</span>
                <span className="text-micro text-text-muted">
                  goals · events · bills · fleet activity
                </span>
              </summary>
              <div className="ui-disclosure-body space-y-4">
                <CardRow alignTop>
                  <Streamed>
                    <GoalsDueCard />
                  </Streamed>
                  <Streamed>
                    <EventsDueCard />
                  </Streamed>
                  <Streamed>
                    <StuckGoalsCard />
                  </Streamed>
                  <Streamed>
                    <SubscriptionsCard />
                  </Streamed>
                </CardRow>
                <Streamed>
                  <FleetBriefCard userId={userId} />
                </Streamed>
                <Streamed>
                  <RecentRunsCard />
                </Streamed>
              </div>
            </details>
            <AutoRefresh intervalMs={REFRESH_CADENCE.today} />
          </>
        )}
      </div>
    </PullToRefresh>
  );
}
