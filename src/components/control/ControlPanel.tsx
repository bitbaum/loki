"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { STATE_DEFINITIONS } from "@/lib/control-states";
import { deriveRunnerPresence, latestRunSignals } from "./control-presenter";
import { postJson } from "@/lib/api/fetch";
import { useControlData } from "@/hooks/use-control-data";
import { useLaunchModal } from "@/hooks/use-launch-modal";
import { useCreateProject } from "@/hooks/use-create-project";
import {
  buildControlPageState,
  buildProjectOperationsSnapshots,
  buildLiveTabRows,
  deriveFleetPulse,
} from "./control-presenter";
import { rememberFleetProject } from "@/lib/fleet-context";
import { ControlFleetStatus } from "./ControlFleetStatus";
import { AttentionBar } from "./AttentionBar";
import { AgentEscalations } from "./AgentEscalations";
import { ControlInbox } from "./ControlInbox";
import { useControlInbox } from "@/hooks/use-control-inbox";
import { RunnerStatusBanner } from "./RunnerStatusBanner";
import { ActivityLogPanel } from "./control-panel-helpers";
import {
  ControlEmptyState,
  ControlNotices,
  LaunchDefaultsSection,
  WorkspacesSection,
} from "./control-panel-sections";
import { ControlPanelModals } from "./ControlPanelModals";
import { useControlDeepLink } from "./use-control-deep-link";
import { LiveTerminalPanel } from "./LiveTerminalPanel";
import { buildCardProps } from "./control-panel-card-props";
import { ProjectOperationsView } from "./ProjectOperationsView";
import { MissingCLIsBanner } from "@/components/desktop/MissingCLIsBanner";
import { useAutomationPolicy } from "@/hooks/use-automation-policy";
import type { AutoInjectMode } from "@/config/beacon";

export function ControlPanel() {
  const {
    data,
    lastUpdated,
    refreshing,
    error,
    setError,
    selectedAgent,
    model,
    switchableRegistry,
    selectedDefinition,
    hasPendingChange,
    savingAgent,
    lastTabResults,
    lastTabResultsAt,
    runtimeAvailable,
    runnerLastPushedAt,
    runnerVersion,
    runnerConnected,
    builderPresence,
    refresh,
    inject,
    launchProject,
    runWithBrain,
    runCustomPrompt,
    saveAgent,
    handleAgentSelect,
    handleModelChange,
  } = useControlData();

  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const automationPolicy = useAutomationPolicy();

  const handleAutomationChange = (next: AutoInjectMode) => {
    void automationPolicy.updateMode(next).then((kick) => {
      if (!kick) return;
      setQueuedNotice(kick.message.replace(/\*\*/g, ""));
      setTimeout(() => setQueuedNotice(null), 9000);
    });
  };
  const [activityOpen, setActivityOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  /**
   * Has the operator OPENED a project, as opposed to one being auto-selected?
   *
   * `selectedTab` cannot answer that: the guard below forces a selection
   * whenever it is null, because the desktop two-column layout must never
   * render an empty detail pane. Correct there, wrong on a phone — it meant
   * /control opened on one project's controls before you had chosen anything,
   * with the chooser below it. Tapping a row then changed only a highlight,
   * because the thing it selects was already on screen three scrolls up.
   *
   * So the phone needs its own answer to "am I looking at the list, or at a
   * project?", and this is it. Desktop ignores it entirely.
   */
  const [projectOpenOnPhone, setProjectOpenOnPhone] = useState(false);
  const [highlightTab, setHighlightTab] = useState<string | null>(null);
  const [liveTargetTab, setLiveTargetTab] = useState<string | null>(null);
  const livePanelRef = useRef<HTMLElement>(null);
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  // Fleet settings — autopilot, refresh, builder detail. Everything the hero
  // used to shout at the top of the page. See ControlSettingsSheet.
  const [fleetSettingsOpen, setFleetSettingsOpen] = useState(false);
  const liveDetailsRef = useRef<HTMLDetailsElement>(null);
  // eslint-disable-next-line react-hooks/purity
  const nowS = Math.floor(Date.now() / 1000);

  // Trigger the hosted one-click installer flow for a specific agent CLI.
  // Re-uses the same primitive as the RunnerStatusBanner "Install X" buttons.
  // Shows the existing queuedNotice toast so the user sees immediate feedback.
  const requestAgentInstall = async (agentId: string) => {
    const label = switchableRegistry.find((e) => e.id === agentId)?.label ?? agentId;
    setQueuedNotice(`Opening install tab for ${label}...`);
    setTimeout(() => setQueuedNotice(null), 6000);
    // Best effort — Fleet Runner (if running) opens the tab via the command queue.
    await postJson("/api/agent/install-cli", { agent: agentId }).catch(() => {});
  };

  const launchableAgents = (data?.agentRegistry.agents ?? []).filter(
    (entry) => entry.capabilities.tabSwitching,
  );

  const {
    launchTarget,
    launchAgentId,
    launchInitialPrompt,
    launchingProject,
    launchError,
    setLaunchTarget,
    setLaunchAgentId,
    setLaunchModel,
    setLaunchInitialPrompt,
    openLaunchModal,
    confirmLaunch,
  } = useLaunchModal({ launchableAgents, selectedAgent, setError, launchProject });

  const {
    newProjectOpen,
    setNewProjectOpen,
    newName,
    setNewName,
    newDir,
    setNewDir,
    newGitUrl,
    setNewGitUrl,
    creatingProject,
    createError,
    createAndLaunch,
  } = useCreateProject({ openLaunchModal, refresh });
  const presence = deriveRunnerPresence({
    runtimeAvailable,
    runnerConnected,
    cloudBuilderPresent: Boolean(builderPresence?.cloud),
    runnerLastPushedAt,
    lastUpdated,
  });
  // Copied out as primitives, not destructured: the React Compiler cannot prove
  // a field read off a returned object stays put, and `runnerSyncStale` feeds a
  // useMemo dependency list.
  const runnerOffline = Boolean(presence.runnerOffline);
  const runnerNeverSeen = Boolean(presence.runnerNeverSeen);
  const runtimeStateKnown = Boolean(presence.runtimeStateKnown);
  const runnerSyncStale = Boolean(presence.runnerSyncStale);
  const runtimeSyncCtx = presence.runtimeSyncCtx;
  const pageState = data
    ? buildControlPageState(data, nowS, runtimeStateKnown, runnerSyncStale)
    : null;
  // One read, two consumers: the hero headline and the "Needs you" panel. See
  // use-control-inbox.ts for why this cannot live inside the panel.
  const inbox = useControlInbox();
  const dashboard = pageState?.dashboard ?? null;
  const attention = pageState?.attention ?? [];
  // Truthful hero headline: what the fleet is actually doing, from live
  // working count + each project's latest run outcome — not the mode toggle.
  const fleetPulse = deriveFleetPulse({
    automationMode: automationPolicy.mode,
    workingCount: dashboard?.runningCount ?? 0,
    waitingCount: dashboard?.waitingCount ?? 0,
    // The hero asks "is anything waiting on me?". The review queue is the one
    // thing on this page that counts exactly that, so the hero reads it rather
    // than leaving it to a panel further down to contradict him.
    inbox: {
      count: inbox.total,
      unknown: inbox.loadFailed && !inbox.settling,
    },
    // Genuine execution stalls (serialized/in-flight commands already filtered
    // out server-side) outrank "Building" — see deriveFleetPulse.
    executionStall: data?.runnerExecutionStall ?? null,
    latestRuns: latestRunSignals(data?.projects ?? [], nowS),
  });
  const liveTabRows = useMemo(
    () => (data ? buildLiveTabRows(data.liveTabs, data.projects, nowS, runnerSyncStale) : []),
    [data, nowS, runnerSyncStale],
  );
  const snapshots = data
    ? buildProjectOperationsSnapshots(
        data.projects,
        data.liveTabs,
        nowS,
        runtimeStateKnown,
        runtimeSyncCtx,
      )
    : null;

  const failedCount = data?.failedCommands?.length ?? 0;

  // Keep the selection valid as the snapshot set changes. Guarded render-time
  // adjustment (React's "adjusting state when props change" pattern) instead
  // of an effect: it converges in one re-render because the fallback tab is
  // always a member of the current snapshot set.
  if (snapshots?.length) {
    const currentValid = selectedTab && snapshots.some((s) => s.project.tab === selectedTab);
    if (!currentValid) {
      const priority = snapshots.find(
        (s) => s.phase === "ready" || s.phase === "orchestration_ready" || s.attentionReason,
      );
      setSelectedTab(priority?.project.tab ?? snapshots[0].project.tab);
    }
  }

  useEffect(() => {
    if (selectedTab) rememberFleetProject(selectedTab);
  }, [selectedTab]);

  useControlDeepLink({
    data,
    snapshots,
    liveTabRows,
    switchableRegistry,
    liveDetailsRef,
    livePanelRef,
    setSelectedTab,
    setProjectOpenOnPhone,
    setHighlightTab,
    setLiveTargetTab,
    setSwitchNotice,
  });

  // Build cardProps unconditionally — the closure is fine with empty arrays
  // when `data` hasn't loaded yet. ProjectOperationsView only invokes the
  // closure when there's a selected project, which requires `snapshots`,
  // which requires `data` to be non-null. So an empty-array cardProps is
  // never actually called against a real project — it's just a typesafe
  // placeholder for the initial paint.
  //
  // The previous `data!.prompts` non-null assertion lied to the TS compiler
  // and crashed in production with "Cannot read properties of null (reading
  // 'prompts')" the first time a user landed on /control before the SWR
  // fetch resolved. Worse on slow networks, every time on cold reload.
  const cardProps = buildCardProps({
    prompts: data?.prompts ?? [],
    liveTabs: data?.liveTabs ?? [],
    selectedAgent,
    switchableRegistry,
    agentOrder: data?.agentOrder ?? null,
    inject,
    runWithBrain,
    runCustomPrompt,
    setError,
    setQueuedNotice,
    refresh,
    openLaunchModal,
    runtimeAvailable,
    runtimeStateKnown,
    runnerSyncStale,
    executionStalled: Boolean(data?.runnerExecutionStall?.stalled),
    automationMode: automationPolicy.mode,
    countdownSeconds: automationPolicy.countdownSeconds,
    nowS,
  });

  const livePanelProps = {
    rows: liveTabRows,
    // Total tabs the builders report, so the panel can admit how many it
    // filtered out instead of presenting a filtered list as "open tabs".
    openTabCount: data?.liveTabs.length ?? 0,
    runnerNeverSeen,
    runnerSyncStale,
    refreshing,
    onRefresh: () => refresh(true),
    onFocusProject: setSelectedTab,
    highlightTab,
    initialTargetTab: liveTargetTab,
    panelRef: livePanelRef,
  };

  // One embedded instance for every breakpoint. This used to render twice
  // (mobile embedded + desktop standalone, toggled via md:hidden), and the
  // standalone variant repeated the <summary>'s "Workspaces · N open" header
  // inside the panel — the page showed the same heading and count twice.
  const livePanel = <LiveTerminalPanel {...livePanelProps} embedded />;

  if (!data) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading live fleet state">
        <div className="ui-panel h-36 animate-pulse bg-surface-base" />
        <div className="ui-control-loading-grid">
          <div className="ui-panel animate-pulse bg-surface-base" />
          <div className="ui-panel animate-pulse bg-surface-base" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ORDERING (the whole page, one rule): Control answers four questions,
          in this order, and every child below belongs to exactly one tier.

            1. Can I operate at all?   RunnerStatusBanner, MissingCLIsBanner
            2. What is waiting on me?  AttentionBar, AgentEscalations
            3. What is the fleet doing? ControlFleetStatus, ProjectOperationsView
            4. What could I do with slack? widget coverage, visitor feedback,
                                          Workspaces, activity log, defaults

          Tiers 1 and 2 are about a human being blocked; 3 and 4 are reporting.
          Reporting never renders above blocking. Before 2026-08-26 the page
          ran 1 -> 3(status) -> 2 -> 4(strips) -> 3(projects): the count of
          projects needing attention appeared under a runner version string,
          and two chore strips sat between that count and the projects
          themselves. Keep new sections in tier order; if a section does not
          obviously belong to one tier, that is a sign it is two sections.

          Tier 1 owns the top viewport when the runner is offline or unseen —
          nothing else on the page is actionable until it reconnects — and
          self-hides when healthy. The old verbose "Agent operations" section
          header stays deleted: it taught nothing the table did not. */}
      {/* Suppress the runner banner during the zero-project empty state —
          EmptyStateWelcome below already pitches "Start a project" / "Install
          Fleet Runner" with the full card grid, and rendering both led to
          the same two CTAs appearing twice on the same screen. The banner
          still fires for users with projects but no runner (legit warning:
          they can't dispatch) and for runner-was-online-now-offline (legit
          troubleshooting). */}
      {!(data && data.projects.length === 0 && runnerNeverSeen && !runnerOffline) && (
        <RunnerStatusBanner
          runnerNeverSeen={runnerNeverSeen}
          runnerOffline={runnerOffline}
          runnerLastPushedAt={runnerLastPushedAt}
          runtimeAvailable={runtimeAvailable}
          hasProjects={(data?.projects.length ?? 0) > 0}
          onRefresh={() => refresh(true)}
        />
      )}

      {/* Desktop-only — surfaces missing agent CLIs so the user
          knows what to install before dispatching. Renders null outside
          Fleet Runner (no IPC) and when all expected tools are present. */}
      <MissingCLIsBanner />

      {data && data.projects.length === 0 && (
        <ControlEmptyState
          onAddManual={() => setNewProjectOpen(true)}
          // Bootstrap requires the local Fleet Runner runner (writes to ~/dev,
          // shells out to `gh repo create`); hide the CTA when runtime isn't
          // available so we don't 503 the user on click.
          onBootstrap={runtimeAvailable ? () => setBootstrapOpen(true) : undefined}
        />
      )}

      {/* Tier 2 of four — see the ordering note at the top of this return.
          Anything actually waiting on the captain outranks the description of
          a fleet that is fine. AttentionBar used to sit BELOW the status panel
          and below two chore strips, so "3 projects need you" arrived after a
          runner version string, a last-sync age and a list of sites missing a
          widget. Whatever needs a human goes above whatever merely reports. */}
      <AttentionBar
        items={attention}
        failedCommands={data?.failedCommands}
        onFocusProject={setSelectedTab}
        // A "tab not found" failure is not retryable — the fix is to start the
        // session it was aiming at. Reuses the launch modal rather than a
        // second launch path, so agent/model defaults stay one decision.
        onStartSession={(tab) => {
          const project = data?.projects.find((p) => p.tab === tab);
          if (!project) {
            setError(`No registered project named "${tab}" — add it before starting a session.`);
            return;
          }
          openLaunchModal(project);
        }}
      />
      {data.projects.length > 0 && <AgentEscalations />}

      {/* Tier 2, with the rest of "what is waiting on me?".
          This panel is titled "Needs you" and renders a count badge, which is
          the definition of tier 2 — yet it sat in tier 4, below the whole
          project list. On a 23-project fleet that put the only thing actually
          needing the operator roughly a screen and a half below a hero reading
          "Idle — nothing queued". The tier rule above is right; this section
          was filed against it.
          It costs what tier 2 can afford because of how it is built: every
          group is ONE line until opened, nothing auto-expands, and the whole
          panel renders nothing at all when the queue is empty. That is two
          rows above the fleet, not the ~1,400px of unbounded strips it
          replaced (#367). Add a GROUP to the inbox; never add a strip here. */}
      <ControlInbox inbox={inbox} />

      {/* ControlFleetStatus shows runner health + working/ready/open counters
          + autopilot pill. When the user has 0 projects, all counters are 0
          and the panel reads as noise stacked under the empty-state welcome
          ("Setup needed · Autopilot Manual · 0 working · 0 ready · 0 open
          · All clear"). Hide it in the empty state; the welcome cards are
          the right surface there. Status panel returns as soon as projects
          exist. */}
      {data && data.projects.length > 0 && (
        <ControlFleetStatus
          dashboard={dashboard}
          failedCount={failedCount}
          runnerNeverSeen={runnerNeverSeen}
          runnerOffline={runnerOffline}
          runnerStateUnknown={runnerNeverSeen}
          runnerLastPushedAt={runnerLastPushedAt}
          runnerVersion={runnerVersion}
          builderVersions={data.builderVersions}
          builderPresence={builderPresence}
          runnerExecutionStall={data.runnerExecutionStall}
          lastUpdated={lastUpdated}
          fleetPulse={fleetPulse}
          // Names, not just a count. "2 need you" that cannot say WHICH two, or
          // take you to either, is a fact you then go hunting for by hand.
          // `tab` IS the project's display name throughout Control (the rail,
          // the cards and the terminal all key off it) — there is no separate
          // title to prefer.
          attentionProjects={attention.map((a) => ({ tab: a.project.tab, name: a.project.tab }))}
          onFocusProject={(tab) => {
            setSelectedTab(tab);
            document
              .getElementById("control-projects")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          onOpenSettings={() => setFleetSettingsOpen(true)}
          onNewProject={() => (runtimeAvailable ? setBootstrapOpen(true) : setNewProjectOpen(true))}
          onFocusCategory={(category) => {
            const match = snapshots?.find(
              (s) => STATE_DEFINITIONS[s.phase].counterCategory === category,
            );
            if (!match) return;
            setSelectedTab(match.project.tab);
            document
              .getElementById("control-projects")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}

      <ProjectOperationsView
        snapshots={snapshots}
        selectedTab={selectedTab}
        onSelect={(tab) => {
          setSelectedTab(tab);
          setProjectOpenOnPhone(true);
        }}
        projectOpenOnPhone={projectOpenOnPhone}
        onBackToList={() => setProjectOpenOnPhone(false)}
        cardProps={cardProps}
        automationMode={automationPolicy.mode}
        onBulkNotice={(msg) => {
          setQueuedNotice(msg);
          setTimeout(() => setQueuedNotice(null), 9000);
          void refresh(true);
        }}
      />

      <WorkspacesSection
        detailsRef={liveDetailsRef}
        tabCount={liveTabRows.length}
        runnerNeverSeen={runnerNeverSeen}
        runnerSyncStale={runnerSyncStale}
      >
        {livePanel}
      </WorkspacesSection>

      {data.recentActivity.length > 0 && (
        <ActivityLogPanel
          activities={data.recentActivity}
          open={activityOpen}
          onToggle={() => setActivityOpen((v) => !v)}
        />
      )}

      <LaunchDefaultsSection
        selectedAgent={selectedAgent}
        switchableRegistry={switchableRegistry}
        model={model}
        hasPendingChange={hasPendingChange}
        savingAgent={savingAgent}
        selectedDefinition={selectedDefinition}
        lastTabResults={lastTabResults}
        lastTabResultsAt={lastTabResultsAt}
        onAgentSelect={handleAgentSelect}
        onModelChange={handleModelChange}
        onSave={saveAgent}
        onRequestInstall={requestAgentInstall}
      />

      <ControlPanelModals
        fleetSettings={
          fleetSettingsOpen
            ? {
                onClose: () => setFleetSettingsOpen(false),
                automationPolicy,
                onAutomationChange: handleAutomationChange,
                refreshing,
                onRefresh: () => refresh(true),
                lastUpdated,
                runnerNeverSeen,
                runnerOffline,
                runnerVersion,
                runnerLastPushedAt,
                builderPresence,
                builderVersions: data?.builderVersions ?? null,
              }
            : null
        }
        bootstrap={
          bootstrapOpen
            ? {
                agentId: selectedAgent,
                agentModel: model,
                onClose: async () => {
                  setBootstrapOpen(false);
                  await refresh(true);
                },
              }
            : null
        }
        newProject={
          newProjectOpen
            ? {
                name: newName,
                dir: newDir,
                gitUrl: newGitUrl,
                error: createError,
                creating: creatingProject,
                onNameChange: setNewName,
                onDirChange: setNewDir,
                onGitUrlChange: setNewGitUrl,
                onCreate: createAndLaunch,
                onClose: () => setNewProjectOpen(false),
              }
            : null
        }
        launch={
          launchTarget
            ? {
                tab: launchTarget.tab,
                dir: launchTarget.dir,
                agents: launchableAgents,
                selectedAgentId: launchAgentId,
                initialPrompt: launchInitialPrompt,
                launching: launchingProject,
                error: launchError,
                onAgentChange: (agentId: string) => {
                  const agent = launchableAgents.find((entry) => entry.id === agentId);
                  setLaunchAgentId(agentId);
                  setLaunchModel(agent?.defaultModel ?? "");
                },
                onInitialPromptChange: setLaunchInitialPrompt,
                onLaunch: confirmLaunch,
                onClose: () => setLaunchTarget(null),
              }
            : null
        }
      />

      <ControlNotices error={error} queuedNotice={queuedNotice} switchNotice={switchNotice} />
    </div>
  );
}
