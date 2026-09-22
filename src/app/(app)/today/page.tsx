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
import { getProjects } from "@/db/queries/projects";
import { hasProjectAttention, isSiteDown } from "@/lib/projects-page-stats";
import { PROJECT_ATTR } from "@/config/project-attrs";
import { signalHasExpired } from "@/lib/project-signals";
import { projectAttentionVerdict } from "@/lib/project-attention";
import { normalizeTabName } from "@/lib/agent-config";
import { getProjectStatesByUserId } from "@/db/queries/project-states";
import { getLatestRunsByProjectPaths } from "@/db/queries/orchestration-runs";
import { hasAnswer } from "@/lib/project-display";
import { NeedsYouVerdict, type FlaggedProject } from "@/components/today/NeedsYouVerdict";
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
  const [projects, orgProjects, entityProjects, projectStates] = await Promise.all([
    step("getUserProjects", () => getUserProjects(userId)),
    step("getOrgProjects", () => getOrgProjects(userId)),
    // For the front-door verdict. Read through the SAME predicate the projects
    // list sorts by, so a project cannot be flagged on one page and calm on
    // the other — two surfaces disagreeing about "needs you" is the defect
    // this whole section exists to end.
    step("getProjects", () => getProjects(userId).catch(() => [])),
    // The other half of "what needs you": a project whose AGENT is blocked.
    // Control counted these and /today did not, so the front door said seven
    // things needed you while Control named a project in none of the seven.
    step("getProjectStates", () => getProjectStatesByUserId(userId).catch(() => [])),
  ]);

  const dirPaths = projects.map((p) => p.dirPath).filter((d): d is string => Boolean(d));
  const latestRuns = await step("getLatestRuns", () =>
    getLatestRunsByProjectPaths(userId, dirPaths).catch(() => new Map()),
  );
  const sessionHealthByTab = new Map(
    projectStates.map((st) => [normalizeTabName(st.projectKey), st.sessionHealth]),
  );

  /* Read through the SAME rule Control's hero uses (lib/project-attention),
     so the two surfaces cannot name different projects. A blocked agent is
     present-tense need: someone has to go and unblock it. */
  const blocked: FlaggedProject[] = projects
    .map((p) => {
      const verdict = projectAttentionVerdict({
        sessionHealth: sessionHealthByTab.get(normalizeTabName(p.name)),
        runHealth: p.dirPath ? latestRuns.get(p.dirPath)?.summary?.health : null,
      });
      return { project: p, verdict };
    })
    .filter(({ verdict }) => verdict.score > 0)
    .map(({ project, verdict }) => ({
      id: project.id,
      name: project.name,
      reason: verdict.reason,
      // Only an ENTITY id resolves at /projects/[id]; a catalog row without
      // one is named without a link rather than linked to a 404.
      href: project.entityProjectId ? `/projects/${project.entityProjectId}` : null,
    }));

  const FLAG_KEYS = [
    PROJECT_ATTR.SECURITY_VULNERABILITY,
    PROJECT_ATTR.BROKEN_FEATURES,
    PROJECT_ATTR.DEPLOYMENT_ISSUE,
  ] as const;

  const flagged: FlaggedProject[] = entityProjects
    .filter((p) => hasProjectAttention(p))
    .map((p) => {
      // The first live flag's OWN WORDS. The sentence someone wrote is what
      // the operator acts on; a count is a number to go and decode.
      const key = FLAG_KEYS.find((k) => hasAnswer(p.attrs[k]) && !signalHasExpired(p.attrMeta, k));
      const raw = key ? p.attrs[key] : isSiteDown(p) ? "Live site is down" : "";
      return {
        id: p.id,
        name: p.name,
        reason: raw.length > 90 ? `${raw.slice(0, 89)}…` : raw,
        href: `/projects/${p.id}`,
      };
    });

  /* One list, so the verdict cannot double-count a project that is BOTH
     flagged and blocked. The flag wins: it says what is wrong in the
     operator's own words, where the blocked reason is a health word. */
  const flaggedHrefs = new Set(flagged.map((f) => f.href));
  const needsYou = [...flagged, ...blocked.filter((b) => !b.href || !flaggedHrefs.has(b.href))];

  return { name, userId, projects, orgProjects, flagged: needsYou };
}

export default async function TodayPage() {
  const { name, userId, projects, orgProjects, flagged } = await loadTodayInputs();
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
            {/* THE ANSWER, FIRST.

                Measured on production 2026-09-22: this page mentioned feedback
                zero times, failures zero times and flagged projects zero times
                — while showing the weather and "92 runs this week", and while
                its own sidebar badged "Feedback 4". A front door that reports
                VOLUME instead of NEED makes you go three clicks away to learn
                whether you are free, and Control and Activity then answered it
                differently from each other. */}
            <NeedsYouVerdict flagged={flagged} />

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
