import Link from "next/link";
import { Suspense } from "react";
import { Activity, CalendarClock, LayoutGrid, Target, Wallet } from "lucide-react";
import { NAV } from "@/config/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { Greeting } from "@/components/today/Greeting";
import { SummaryBar, SummaryBarSkeleton } from "@/components/today/SummaryBar";
import { CalendarCard } from "@/components/today/CalendarCard";
import { WeatherCard } from "@/components/today/WeatherCard";
import { CommitmentsCard } from "@/components/today/CommitmentsCard";
import { LogConversationButton } from "@/components/today/LogConversationButton";
import { StickyNoteCard } from "@/components/today/StickyNoteCard";
import { HabitsCard } from "@/components/today/HabitsCard";
import { LockedZoneBanner } from "@/components/today/LockedZoneBanner";
import { TodayWatch } from "@/components/today/TodayWatch";
import { requirePageUserId, getCurrentUserName } from "@/lib/session";
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import { getProjects } from "@/db/queries/projects";
import { listSharedProjects } from "@/db/queries/project-access";
import { SharedProjectsCard } from "@/components/projects/SharedProjectsCard";
import { hasProjectAttention, isSiteDown } from "@/lib/projects-page-stats";
import { PROJECT_ATTR } from "@/config/project-attrs";
import { signalIsLive } from "@/lib/project-signals";
import { projectAttentionVerdict } from "@/lib/project-attention";
import { normalizeTabName } from "@/lib/agent-config";
import { getProjectStatesByUserId } from "@/db/queries/project-states";
import { getLatestRunsByProjectPaths } from "@/db/queries/orchestration-runs";
import { NeedsYouVerdict, type FlaggedProject } from "@/components/today/NeedsYouVerdict";
import { loadNeedsYouExtras } from "@/lib/needs-you-server";
import { FIRST_RUN } from "@/lib/constants/today";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { AutoRefresh } from "@/components/shared/AutoRefresh";
import { REFRESH_CADENCE } from "@/config/refresh";
import { AwayReturnCard } from "@/components/shell/AwayReturnCard";
import { LastNightCard } from "@/components/today/LastNightCard";
import { ListenBriefButton } from "@/components/today/ListenBriefButton";
import { lastNightNote } from "@/lib/autopilot-night-note";
import { isFreshNight } from "@/config/autopilot-night";
import { StartMyDay } from "@/components/control/StartMyDay";

export const metadata = { title: "Today" };

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
  const [projects, orgProjects, entityProjects, projectStates, sharedProjects] = await Promise.all([
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
    // Projects someone else shared: a Builder who owns nothing was told "Add
    // a project" here, though the one they were invited to was their way in.
    step("listSharedProjects", () => listSharedProjects(userId).catch(() => [])),
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
      const key = FLAG_KEYS.find((k) => signalIsLive(p.attrMeta, k, p.attrs[k]));
      const siteDown = isSiteDown(p);
      const raw = key ? p.attrs[key] : siteDown ? "Live site is down" : "";
      return {
        id: p.id,
        name: p.name,
        reason: raw.length > 90 ? `${raw.slice(0, 89)}…` : raw,
        fullReason: raw,
        // An exposed hole or a dead site is the morning's first job, ahead of
        // every approval and report (lib/needs-you tiers).
        urgent: key === PROJECT_ATTR.SECURITY_VULNERABILITY || (!key && siteDown),
        href: `/projects/${p.id}`,
      };
    });

  /* One list, so the verdict cannot double-count a project that is BOTH
     flagged and blocked. The flag wins: it says what is wrong in the
     operator's own words, where the blocked reason is a health word. */
  const flaggedHrefs = new Set(flagged.map((f) => f.href));
  const needsYou = [...flagged, ...blocked.filter((b) => !b.href || !flaggedHrefs.has(b.href))];

  // Approvals and alerts join the same list — they used to be two more cards
  // below it, each with its own count and its own wall of detail.
  // Last night's autopilot note, only on the morning it happened. A failure
  // here costs the line, never the page.
  const [extras, night] = await Promise.all([
    step("loadNeedsYouExtras", () => loadNeedsYouExtras(userId)),
    lastNightNote(userId).catch(() => null),
  ]);
  const nightNote = night && isFreshNight(night.night) ? night.note : null;

  return {
    name,
    userId,
    projects,
    orgProjects,
    sharedProjects,
    flagged: needsYou,
    extras,
    nightNote,
  };
}

/** The pages behind Today's recap, as rows — they were four summary cards
 *  in a "Recap & reference" disclosure, each restating a page in the nav. */
const MORE = [
  { href: NAV.goals.href, icon: Target, title: "Goals", secondary: "Due soon and stalled" },
  { href: NAV.events.href, icon: CalendarClock, title: "Events", secondary: "Deadlines coming up" },
  { href: NAV.money.href, icon: Wallet, title: "Money", secondary: "Bills and subscriptions" },
  { href: NAV.activity.href, icon: Activity, title: "Activity", secondary: "What the builds did" },
];

export default async function TodayPage() {
  const { name, projects, orgProjects, sharedProjects, flagged, extras, nightNote } =
    await loadTodayInputs();
  const isFirstRun = projects.length === 0 && orgProjects.length === 0;
  // Owns nothing yet, but is on someone else's project: that project is the
  // first thing to do, not "Add a project".
  const onlyShared = isFirstRun && sharedProjects.length > 0;

  /* Modelled on OrangeCat's Cat page (design reset, 2026-10): a greeting,
     one sentence of the day, then what matters today as sections of rows on
     the page itself. It was thirteen bordered cards — a chip row of counts,
     calendar and weather side by side, habits beside commitments, and a
     "Recap & reference" box of four more cards. */
  return (
    <PullToRefresh>
      <div className="app-page ui-today-page max-w-2xl space-y-6 md:space-y-8">
        <header className="ui-today-head">
          <Greeting name={name} />
          {!isFirstRun && (
            <Suspense fallback={<SummaryBarSkeleton />}>
              {/* The day in one sentence, then Plan my day (which carries the
                  counts) and Log a conversation. */}
              <SummaryBar>
                <LogConversationButton />
              </SummaryBar>
            </Suspense>
          )}
        </header>

        {onlyShared && <SharedProjectsCard projects={sharedProjects} />}
        {isFirstRun && !onlyShared && (
          <EmptyState
            icon={LayoutGrid}
            title={FIRST_RUN.title}
            action={
              <Link href={NAV.control.href} className="ui-btn-secondary">
                {FIRST_RUN.cta}
              </Link>
            }
          />
        )}

        {!isFirstRun && (
          <>
            {/* What happened while you were gone, then what needs you. Each
                piece renders nothing when it has nothing to say. */}
            <AwayReturnCard />
            <StartMyDay />
            <LastNightCard note={nightNote} />
            {nightNote && <ListenBriefButton nightNote={nightNote} />}

            {/* THE ANSWER, FIRST — the only place "N things need you" is
                said (lib/needs-you). */}
            <Section title="Needs you">
              <NeedsYouVerdict
                flagged={flagged}
                approvals={extras.approvals}
                alerts={extras.alerts}
                systemAlertCount={extras.systemAlertCount}
              />
            </Section>

            <Suspense fallback={null}>
              <LockedZoneBanner />
            </Suspense>

            {/* Loki's read on the private zone — renders only when unlocked. */}
            <Suspense fallback={null}>
              <TodayWatch />
            </Suspense>

            {/* Today itself: the weather in one line, then the calendar. Below
                what needs you on purpose — volume never sits above need
                (scripts/test/today-answers-the-question.ts). */}
            <WeatherCard />
            <CalendarCard />

            {/* Habits are a today action (check one off). */}
            <Suspense fallback={null}>
              <HabitsCard />
            </Suspense>
            <Suspense fallback={null}>
              <CommitmentsCard />
            </Suspense>

            {/* The one list you write into. */}
            <Suspense fallback={null}>
              <StickyNoteCard />
            </Suspense>

            <Section title="More">
              <List aria-label="More">
                {MORE.map((m) => (
                  <ListRow
                    key={m.href}
                    href={m.href}
                    icon={m.icon}
                    title={m.title}
                    secondary={m.secondary}
                    chevron
                  />
                ))}
              </List>
            </Section>
            <AutoRefresh intervalMs={REFRESH_CADENCE.today} />
          </>
        )}
      </div>
    </PullToRefresh>
  );
}
