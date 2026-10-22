"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MonitorSmartphone } from "lucide-react";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { deriveExecutorHonestyLabel } from "@/lib/executor-honesty";
import { useFetch } from "@/hooks/use-fetch";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { useTerminalInput } from "@/hooks/use-terminal-input";
import { useTerminalFont } from "@/hooks/use-terminal-font";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useTerminalDeck } from "@/hooks/use-terminal-deck";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { fleetSurfaceHref, rememberFleetProject } from "@/lib/fleet-context";
import { useFleetProject } from "@/hooks/use-fleet-project";
import { resolveTabAttachment, type PtyGeometry } from "@/lib/terminal-viewport";
import type { BuilderChannel } from "@/lib/event-stream-types";
import { resolveTerminalSource } from "@/lib/terminal-deep-link";
import {
  TERMINAL_MODE_STORAGE_KEY,
  TERMINAL_RAIL_QUERY,
  TERMINAL_RAIL_STORAGE_KEY,
  TERMINAL_SOURCES,
  type TerminalSource,
} from "@/config/terminal-modes";
import type { TerminalContext } from "@/app/api/terminal/context/route";
import { TerminalView } from "./TerminalView";
import { TerminalLokiSheet, useTerminalExplain } from "./TerminalExplain";
import { TerminalSessionBar, TerminalSourceBar } from "./TerminalModeBar";
import { SessionComposer } from "./SessionComposer";
import { TerminalResume } from "./TerminalResume";
import { TerminalNewSessionSheet } from "./TerminalNewSessionSheet";
import { sessionLaunchProps } from "./session-launch";
import { TerminalSessionNotice } from "./TerminalSessionNotice";
import { useSessionStatuses } from "./use-session-statuses";
import { ShellWorkspace } from "./ShellWorkspace";
import { TerminalSessionMiss } from "./TerminalSessionMiss";
import { TerminalMobileHeader, type TerminalLiveState } from "./TerminalMobileHeader";
import { TerminalSessionSheet } from "./TerminalSessionSheet";
import { TerminalMoreSheet } from "./TerminalMoreSheet";
import { useImmersiveChat } from "@/hooks/use-immersive-chat";
import { TerminalMobileDock } from "./TerminalMobileDock";
import { TerminalLokiRail } from "./TerminalLokiRail";
import { buildStripTabs, agentName } from "./terminal-strip-tabs";
import { SESSION_STATUS_WORDS } from "@/lib/terminal-session-status";
import { TerminalAgentTabs } from "./TerminalAgentTabs";
import { runnerTransport } from "./terminal-transport";
import { ClaudeChatView } from "./ClaudeChatView";
import { TerminalOfflineActions } from "./TerminalOfflineActions";
import { cloudBuilderState } from "@/lib/builder-way-forward";
import type { BuilderPresenceSnapshot } from "@/hooks/use-builder-presence";
import { TerminalPaneActions } from "./TerminalPaneActions";
import { SectionHeading } from "@/components/ui/section-heading";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { projectTitle } from "@/lib/project-display";
import { useTerminalView } from "./use-terminal-view";
import { useScreenSuggestions } from "./use-screen-suggestions";
import { TerminalActions } from "./TerminalActions";
import { useTerminalTabs } from "./use-terminal-tabs";
import { activeAgentFor } from "./terminal-agent";
import { useTerminalTabActions } from "./use-terminal-tab-actions";

/** Per-source copy. Cloud and machine differ only in wording, so the strings
 *  stay in the copy SSOT and this map just selects between them. */
const COPY: Record<
  "cloud" | "machine",
  {
    loading: string;
    empty: string;
    emptyHint: string;
    offlineHint: string;
    stalledHint: string;
  }
> = {
  cloud: {
    loading: EXECUTOR_COPY.terminal.cloudLoading,
    empty: EXECUTOR_COPY.terminal.cloudEmpty,
    emptyHint: EXECUTOR_COPY.terminal.cloudEmptyHint,
    offlineHint: EXECUTOR_COPY.terminal.cloudOfflineHint,
    stalledHint: EXECUTOR_COPY.terminal.cloudStalledHint,
  },
  machine: {
    loading: EXECUTOR_COPY.terminal.thisComputerLoading,
    empty: EXECUTOR_COPY.terminal.thisComputerEmpty,
    emptyHint: EXECUTOR_COPY.terminal.thisComputerEmptyHint,
    offlineHint: EXECUTOR_COPY.terminal.thisComputerOfflineHint,
    stalledHint: EXECUTOR_COPY.terminal.thisComputerStalledHint,
  },
};

/**
 * The builder chip, scoped to THIS source. Using any-builder `runnerConnected`
 * on the cloud tab labelled a laptop-only online state as "Cloud builder
 * online", and the inverse (null while presence loads) as "Cloud builder
 * offline" while the box was shipping. Live tabs are the tie-break when
 * channels disagree with presence — same rule as useTerminalTabs.offline.
 * A private cloud is not an offline one: a new account read "Cloud builder
 * offline" beside "private for this account" (2026-10-12).
 */
function terminalHonesty(input: {
  source: TerminalSource;
  gatedMessage: string | null;
  presence: BuilderPresenceSnapshot;
  tabs: string[];
  local: boolean;
}): ReturnType<typeof deriveExecutorHonestyLabel> {
  const { source, gatedMessage, presence, tabs, local } = input;
  if (source === "cloud" && gatedMessage) {
    return {
      kind: "needs-builder",
      label: EXECUTOR_COPY.builder.cloudPrivate,
      title: gatedMessage,
    };
  }
  if (presence.builderPresence == null && tabs.length === 0) return null;
  const channelOnline =
    source === "machine" ? presence.builderPresence?.local : presence.builderPresence?.cloud;
  const runnerConnected = channelOnline ?? tabs.length > 0;
  return deriveExecutorHonestyLabel(
    source === "machine"
      ? { runnerConnected, runtimeAvailable: false, scope: "machine" }
      : { runnerConnected, runtimeAvailable: local || presence.runtimeAvailable, scope: "cloud" },
  );
}

const channelFor = (source: TerminalSource): BuilderChannel =>
  source === "machine" ? "local" : "cloud";

/**
 * The line under an empty terminal. The machine source's offline copy names
 * "here" — the device reading the page — which from a second computer is the
 * wrong computer. An account with the cloud builder is told the way that
 * works from anywhere instead.
 */
function emptyStateHint(input: {
  offline: boolean;
  source: TerminalSource;
  presence: BuilderPresenceSnapshot;
  tabHint: string | null;
}): string {
  const copy = COPY[input.source === "machine" ? "machine" : "cloud"];
  if (!input.offline) return input.tabHint ?? copy.emptyHint;
  if (input.source !== "machine") return copy.offlineHint;
  const cloud = cloudBuilderState(
    input.presence.cloudBuilderAllowed,
    input.presence.builderPresence,
  );
  if (cloud === "online") return EXECUTOR_COPY.terminal.thisComputerOfflineCloudHint;
  if (cloud === "offline") return EXECUTOR_COPY.terminal.thisComputerOfflineCloudDownHint;
  return copy.offlineHint;
}

// The stored value once also held an input mode (Type / Prompt / Voice). There
// is one session box now; an old stored `input` is simply ignored.
type TerminalMode = { source: TerminalSource };

const DEFAULT_MODE: TerminalMode = { source: "cloud" };

// Module-level so their identity is stable across renders — useLocalStorageState
// keeps them in effect dependency arrays.
const serializeMode = (mode: TerminalMode) => JSON.stringify(mode);
const serializeRail = (open: boolean) => (open ? "1" : "0");
const deserializeRail = (raw: string) => raw !== "0";
const deserializeMode = (raw: string): TerminalMode => {
  try {
    const parsed = JSON.parse(raw) as Partial<TerminalMode>;
    return { source: parsed.source ?? DEFAULT_MODE.source };
  } catch {
    return DEFAULT_MODE;
  }
};

/**
 * The terminal — one shell, three substrates.
 *
 * The previous version of this file was a source toggle over two structurally
 * different UIs: a tabbed, splittable workspace (server-owned PTYs, reachable
 * only when RUNTIME_AVAILABLE=true, so never on the hosted app) and a sidebar
 * list of agent tabs beside a single read-mostly xterm. Switching source
 * changed the layout, the tab metaphor and the available actions all at once,
 * and neither half offered any way to change agent or to compose a task — those
 * lived on Control, acting on the same session from another page.
 *
 * Now the chrome is constant: tab strip, session bar, session, and ONE box
 * for the agent (SessionComposer) — the same box in the terminal view and the
 * conversation view. The source picks which transport fills the session.
 * Nothing about navigating changes when you switch.
 *
 * ── The phone ───────────────────────────────────────────────────────────────
 * Below `md` the same state drives a different chrome, because the desktop one
 * had failed on a phone in two ways at once.
 *
 * It was too big: title, subtitle, source strip, tab strip, source select,
 * session select, agent button, mode select, honesty chip, font stepper — 331px
 * of controls, measured, above a terminal left with four visible lines of an
 * eighty-column screen. All of it setup, none of it read while an agent works.
 * It is now one header row and a sheet behind it.
 *
 * And it was inert: a phone keyboard has no arrows, no Esc, no Tab and no Ctrl,
 * which are exactly the keys an agent's questions are answered with. You could
 * read "[✔] Also scan shell history · ◄ Mixed ► · Continue" and had no way to
 * say anything back. TerminalKeyDeck is that missing half of the keyboard, and
 * it is why this page is now something you can work in rather than watch.
 */
export function TerminalSurface({
  local,
  immersive = false,
  onToggleImmersive,
  initialSource,
  initialTab,
  initialRunId = null,
  initialExplain = false,
  initialPrompt = null,
}: {
  local: boolean;
  immersive?: boolean;
  /** Phone full-screen toggle — rendered inside the mobile control bar. */
  onToggleImmersive?: () => void;
  initialSource?: TerminalSource;
  /** Tab or project name from URL. When from ?project=, this is the project key
   *  that will be resolved to the actual tab name via context lookup. */
  initialTab?: string | null;
  /** Same orchestration run Feedback Watch is following (`?run=`). */
  initialRunId?: string | null;
  /** `?explain=1` — arrived from a "What's going on?" tap elsewhere: open
   *  Loki and answer it as soon as the session is on screen. */
  initialExplain?: boolean;
  /** `?q=` — put these words in the rail's composer, for the person to check
   *  and send. The widget's "Continue in Loki → Terminal" carries the thread. */
  initialPrompt?: string | null;
}) {
  // "shell" — a Loki-owned bash PTY — is only offered where one can
  // actually be provisioned. On the hosted control plane it is absent rather
  // than present-and-broken.
  const sources: TerminalSource[] = local ? ["cloud", "machine", "shell"] : ["cloud", "machine"];

  const [mode, setMode] = useLocalStorageState<TerminalMode>(
    TERMINAL_MODE_STORAGE_KEY,
    DEFAULT_MODE,
    serializeMode,
    deserializeMode,
  );

  // Precedence: what the user just clicked > the deep link that opened the page
  // > the remembered mode. Reading the deep link on every render instead would
  // pin the source forever — arriving via ?source=cloud made the toggle inert,
  // because each click was immediately overruled by the unchanged URL.
  const [pickedSource, setPickedSource] = useState<TerminalSource | null>(null);

  // Auto-switch preparation: poll both sources to see which has the requested tab
  // A deep link that names a PROJECT can never mean the shell source.
  //
  // The shell is a plain Loki-owned bash PTY with no concept of project tabs —
  // `stripTabs` is not even passed when source === "shell". But the source here
  // fell back to `mode.source`, which is REMEMBERED IN LOCALSTORAGE, so anyone
  // who had once picked Shell got sent to a bash prompt by every "Watch" and
  // "Open terminal" link on Control. Measured 2026-09-13: dispatching to
  // truthseeker-tmp, clicking the "Watch" link on the resulting Queued banner
  // landed on an unrelated bash session showing a week-old panic message. The
  // agent was running the whole time; the page just opened somewhere else.
  //
  // An EXPLICIT ?source=shell is still honoured — that is the reader asking.
  // Only the remembered value is overridden, and only when a project was named.
  const desiredSourceFromUrl = resolveTerminalSource({
    fromUrl: initialSource,
    remembered: mode.source,
    projectRequested: Boolean(initialTab),
    available: sources,
  });
  const primarySource: TerminalSource = sources.includes(desiredSourceFromUrl)
    ? desiredSourceFromUrl
    : "cloud";
  const primaryChannel = channelFor(primarySource);
  const primaryTabs = useTerminalTabs(primaryChannel);

  // The project the operator is looking at, independent of whether a PTY is
  // attached. The empty state needs exactly this: `activeTab` is null there by
  // definition, so anything derived from it silently loses the scope that the
  // tab strip above is still showing.
  const fleetProject = useFleetProject();

  const otherSource: TerminalSource | null =
    primarySource === "machine" && sources.includes("cloud")
      ? "cloud"
      : primarySource === "cloud" && sources.includes("machine")
        ? "machine"
        : null;
  const otherChannel = otherSource ? channelFor(otherSource) : null;
  const otherSourceTabs = useTerminalTabs(otherChannel ?? primaryChannel);

  // Fetch context to map project names to tab names (must happen before resolving initialTab)
  const primaryContext = useFetch<TerminalContext>(
    `/api/terminal/context?channel=${primaryChannel}`,
    { intervalMs: 15000 },
  );
  const otherContext = useFetch<TerminalContext>(
    otherChannel ? `/api/terminal/context?channel=${otherChannel}` : null,
    { intervalMs: 15000 },
  );

  // Resolve project name to actual tab name using the same logic Control uses.
  // When initialTab is "loki" (project) but the actual tab is "Bitbaum",
  // this maps it so all lookups use "Bitbaum". Prevents "tab not found" when
  // Watch/Focus/Open pass a project name instead of the live tab name.
  const resolveProjectToTab = useCallback(
    (projectOrTab: string | null | undefined, ctx: typeof primaryContext.data): string | null => {
      if (!projectOrTab || !ctx) return projectOrTab ?? null;
      const lower = projectOrTab.toLowerCase();

      // 1. Direct tab name match (case-insensitive)
      const directMatch = ctx.tabs.find((t) => t.tab.toLowerCase() === lower);
      if (directMatch) return directMatch.tab;

      // 2. Project name match - find tab whose projectName matches
      const projectMatch = ctx.tabs.find((t) => t.projectName?.toLowerCase() === lower);
      if (projectMatch) return projectMatch.tab;

      // 3. No match - return original (may not exist, but that's what deepLinkMiss handles)
      return projectOrTab;
    },
    // ctx parameter is used, not primaryContext - disable exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Resolve initialTab on BOTH sources to determine auto-switch
  const resolvedOnPrimary = resolveProjectToTab(initialTab, primaryContext.data);
  const resolvedOnOther = resolveProjectToTab(initialTab, otherContext.data);

  // Auto-switch when: resolved tab not on primary source, but IS on other source
  const shouldUseOtherSource =
    resolvedOnPrimary &&
    !primaryTabs.loading &&
    !primaryTabs.tabs.some((t) => t.toLowerCase() === resolvedOnPrimary.toLowerCase()) &&
    otherSource &&
    !otherSourceTabs.loading &&
    otherSourceTabs.tabs.some((t) => t.toLowerCase() === (resolvedOnOther ?? "").toLowerCase());

  // Final source decision: user click > auto-switch > deep link > remembered mode
  const source: TerminalSource =
    pickedSource && sources.includes(pickedSource)
      ? pickedSource
      : shouldUseOtherSource
        ? otherSource!
        : primarySource;

  const channel = channelFor(source);
  const copy = COPY[source === "machine" ? "machine" : "cloud"];
  const { tabs, loading, gatedMessage, offline, presence } =
    source === primarySource ? primaryTabs : otherSourceTabs;

  // Use context for the active source
  const context = source === primarySource ? primaryContext.data : otherContext.data;

  // Final resolved tab for the active source
  const resolvedInitialTab = resolveProjectToTab(initialTab, context);

  const setSource = (next: TerminalSource) => {
    setPickedSource(next);
    setMode((m) => ({ ...m, source: next }));
  };

  // Separate user's manual selection from the deep-linked/resolved initial tab.
  // This way, selected automatically updates when resolvedInitialTab changes
  // (e.g., when context loads and maps "loki" → "Bitbaum"), without
  // needing an effect that triggers cascading renders.
  const [userSelection, setUserSelection] = useState<string | null>(null);
  const selected = userSelection ?? resolvedInitialTab;
  // A ?tab= deep link that matched nothing must not quietly attach to whatever
  // else is running — see resolveTabAttachment for the incident this encodes.
  // But only show the miss UI after we've checked both sources (auto-switch above).
  // Use resolvedInitialTab (already mapped from project to tab) for all matching.
  const { activeTab, deepLinkMiss: rawDeepLinkMiss } = resolveTabAttachment({
    requestedTab: resolvedInitialTab,
    selected,
    tabs,
    loading,
  });
  // Auto-switching is already reflected in `source` and therefore in `tabs`.
  // Do not consult the statically named `otherSourceTabs` here: after a manual
  // source switch that hook can describe the CURRENT source, which suppressed
  // the miss state and left activeTab/transport null. That was the production
  // "Cannot read properties of null (reading 'key')" crash.
  const deepLinkMiss = Boolean(rawDeepLinkMiss && resolvedInitialTab);

  // The terminal is one of the four project surfaces, so the tab you are
  // watching IS the fleet's active project — Control, Loki and the project
  // profile follow you here instead of resetting.
  useEffect(() => {
    if (activeTab) rememberFleetProject(activeTab);
  }, [activeTab]);

  // One transport per attached session, shared by the view that renders it and
  // the key deck that writes into it. Both need the same PTY; making it here
  // rather than inline at the view keeps "which session am I typing into"
  // impossible to get wrong.
  const transport = useMemo(
    () => (activeTab ? runnerTransport(activeTab, channel) : null),
    [activeTab, channel],
  );
  // Awaited chunk-by-chunk: /api/control/tab-inject-raw caps one write at 4000
  // bytes, and the composer will happily hand over a pasted paragraph. Sending
  // the pieces without awaiting would let them arrive out of order — the same
  // "echo" → "ehco" reordering TerminalView's own input buffer exists to stop.
  // Every write goes through ONE chain, so a long paste split into chunks can
  // never be overtaken by the Enter sent after it — and the caller can await
  // the moment the last byte has actually left.
  const sendKey = useTerminalInput(transport);
  // What the session box sends with: a failed write is reported, so the box
  // keeps the words instead of clearing them as if they had gone.
  const sendReported = useCallback((bytes: string) => sendKey(bytes, true), [sendKey]);

  // Phone chrome state. Font and stream status are owned here rather than
  // inside TerminalView because the controls that read them now live outside
  // it — the header shows the live dot, the sheet steps the font.
  const font = useTerminalFont();
  const deck = useTerminalDeck();
  const keyboardInset = useKeyboardInset();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // An open session owns the phone, as an open conversation does: the app's
  // top bar and bottom tabs step aside and the header's "back" leads out.
  useImmersiveChat(Boolean(activeTab) || source === "shell");
  // The phone's "+" (the desktop strip opens its own panel instead).
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  // The rail beside the session (lg+). Closing it hands its columns to the
  // terminal; the choice is remembered, like the source.
  const [railOpen, setRailOpen] = useLocalStorageState<boolean>(
    TERMINAL_RAIL_STORAGE_KEY,
    true,
    serializeRail,
    deserializeRail,
  );
  // Whether the rail can sit beside the session at this width at all. Below
  // it the rail is a sheet, and the toggle opens that instead.
  const railFits = useMediaQuery(TERMINAL_RAIL_QUERY);
  const explainer = useTerminalExplain(initialExplain, railFits, () => setRailOpen(true));
  const [liveState, setLiveState] = useState<TerminalLiveState>("connecting");
  // A press on the read-only screen means "let me write": the session box
  // takes the cursor. (Where keystrokes go live, the screen takes them itself.)
  const [focusRequest, setFocusRequest] = useState(0);
  const writeToSession = () => setFocusRequest((n) => n + 1);
  // Words for the session box that the person did not type: `?q=` on arrival,
  // or a step from Loki's summary. Checked and sent by them.
  const [sessionDraft, setSessionDraft] = useState<{ text: string; nonce: number } | null>(() =>
    initialPrompt ? { text: initialPrompt, nonce: 1 } : null,
  );
  const [keysOpen, setKeysOpen] = useState(false);
  // The attached session's rendered screen, for the rail's AI summary.
  const readScreenRef = useRef<((rows: number) => string[]) | null>(null);
  const [geometry, setGeometry] = useState<PtyGeometry | null>(null);

  const honesty = terminalHonesty({ source, gatedMessage, presence, tabs, local });

  // Agent roster derived from context (already fetched above for tab resolution)
  const agents = useMemo(
    () => (context?.agents.agents ?? []).filter((a) => a.switchable),
    [context],
  );
  const tabContext = context?.tabs.find((t) => t.tab === activeTab) ?? null;
  // The agent RUNNING in the tab, not the one the project prefers: see
  // terminal-agent.ts. The switcher label, the Claude | Terminal toggle and the
  // chat view all hang off this.
  const activeAgentId = activeAgentFor({
    liveAgents: tabContext?.liveAgents ?? [],
    rosterIds: (context?.agents.agents ?? []).map((a) => a.id),
    pref: tabContext?.agentPref,
    fallback: context?.agents.defaultAgent,
  });
  const termView = useTerminalView(activeAgentId);
  // Sessions whose builder never sends the conversation: shown as the terminal
  // and offered no conversation toggle, without touching the saved preference
  // (the next session, on a newer runner, still opens as a conversation).
  const [noTranscript, setNoTranscript] = useState<ReadonlySet<string>>(() => new Set());
  const transcriptMissing = activeTab !== null && noTranscript.has(activeTab);
  const chatAvailable = termView.chatAvailable && !transcriptMissing;
  const view = transcriptMissing ? "terminal" : termView.view;
  const projectKey = tabContext?.projectName ?? activeTab ?? initialTab ?? null;
  const screenNext = useScreenSuggestions(
    readScreenRef,
    Boolean(activeTab) && view === "terminal",
    projectKey,
    false,
    activeAgentId,
  );

  const ta = useTerminalTabActions(channel, tabs.length, {
    tab: activeTab,
    dir: tabContext?.dir ?? null,
    activeAgentId,
  });
  const agentSwitchDisabledReason = !activeTab
    ? "Open a session first — switching swaps the CLI running in a tab."
    : !tabContext?.dir
      ? "This session has no project folder, so its agent cannot be changed."
      : null;
  const news = useSessionStatuses(activeTab);
  const stripTabs = useMemo(
    () => buildStripTabs(tabs, context, activeTab, ta.aliases, ta.layout, news.statuses),
    [tabs, activeTab, context, ta.aliases, ta.layout, news.statuses],
  );

  // Where the sessions run, in the words the session sheet uses ("Cloud",
  // "Your computer") — never "Cloud builder" on a person's screen.
  const sourceLabel = TERMINAL_SOURCES.find((s) => s.id === source)?.label ?? "Cloud";

  // Constant across substrates: scope on top, then the tab strip, then the
  // controls that act on the selected tab.
  const sourceBar = (
    <div className="hidden md:block">
      <TerminalSourceBar
        source={source}
        onSourceChange={setSource}
        sources={sources}
        honesty={honesty}
      />
    </div>
  );

  // The phone's one header row. What it names is what changes: which session,
  // what is running in it, whether it is alive. Everything else is one tap
  // behind it, in the sheet.
  const activeStrip = stripTabs.find((t) => t.id === activeTab);
  const headerTitle =
    source === "shell"
      ? "Shell"
      : (activeStrip?.label ?? (activeTab ? projectTitle({ name: activeTab }) : "Sessions"));
  const agentShown = source === "shell" || !activeTab ? null : activeAgentId;
  const headerAgent =
    agentShown && agentName(activeStrip?.badge, context?.agents.agents, agentShown);
  const headerState: TerminalLiveState = !activeTab && source !== "shell" ? "idle" : liveState;
  const launchProps = sessionLaunchProps({
    context,
    agents,
    activeProject: tabContext?.projectName ?? fleetProject,
    channel,
    openTabs: tabs,
    select: setUserSelection,
  });
  const mobileHeader = (
    <TerminalMobileHeader
      title={headerTitle}
      agent={headerAgent}
      state={headerState}
      status={activeStrip?.status ?? null}
      builder={source === "shell" ? null : sourceLabel}
      sessionCount={source === "shell" ? 0 : stripTabs.length}
      backHref={fleetSurfaceHref("control", projectKey ?? fleetProject)}
      onOpenSheet={() => setSheetOpen(true)}
      onOpenMore={() => setMoreOpen(true)}
      view={view}
      onViewChange={activeTab && chatAvailable ? termView.setView : undefined}
    />
  );

  // New element per call — never reuse one descriptor in the split AND the sheet.
  const renderLokiRail = (presentation: "rail" | "sheet") =>
    projectKey ? (
      <TerminalLokiRail
        presentation={presentation}
        key={`${projectKey}:${initialRunId ?? "latest"}:${channel}`}
        project={projectKey}
        tab={activeTab}
        runId={initialRunId}
        ptyState={liveState}
        projectId={tabContext?.projectId ?? null}
        canSwitchAgent={!agentSwitchDisabledReason}
        onSwitchAgent={(id) => void ta.switchAgent(id)}
        readScreenRef={readScreenRef}
        // Loki's panel only ASKS: the session box under the terminal is where
        // words for the agent go, in both views. A summary's step lands there.
        askOnly
        explain={explainer}
        onStep={(text) => {
          setSessionDraft({ text, nonce: Date.now() });
          explainer.setSheetOpen(false);
        }}
        agent={activeAgentId}
        onKey={activeTab ? sendKey : undefined}
      />
    ) : null;

  // Pane controls, in the terminal's own status row (desktop). Where the rail
  // cannot sit beside the session (md–lg) the same button opens it as a sheet,
  // so the panel is one click away at every width instead of only on lg+.
  const railShown = Boolean(projectKey) && railOpen && railFits && !immersive;
  const toggleRail = () => {
    if (railFits) setRailOpen((open) => !open);
    else explainer.setSheetOpen(true);
  };
  const paneActions = (
    <TerminalPaneActions
      loki={
        projectKey ? { shown: railShown, pressable: railFits, onToggle: toggleRail } : undefined
      }
      immersive={immersive}
      onToggleImmersive={onToggleImmersive}
    />
  );

  const sheet = sheetOpen ? (
    <TerminalSessionSheet
      onClose={() => setSheetOpen(false)}
      source={source}
      sources={sources}
      onSourceChange={setSource}
      // The shell substrate owns its own tabs and splits, and runs no agent —
      // so it gets the source section and none of the per-session ones.
      // Passing the agent path's activeTab through would offer to switch the
      // agent in a session the shell is not showing.
      tabs={source === "shell" ? undefined : stripTabs}
      activeTab={source === "shell" ? null : activeTab}
      onSelectTab={source === "shell" ? undefined : setUserSelection}
      onCloseTab={source === "shell" ? undefined : (id) => void ta.closeTab(id)}
      onNewSession={
        source !== "shell" && launchProps && !gatedMessage && !offline
          ? () => setNewSessionOpen(true)
          : undefined
      }
      agents={agents}
      activeAgentId={activeAgentId}
      onSwitchAgent={(id) => void ta.switchAgent(id)}
      switchingAgent={ta.switchingAgent}
      agentSwitchDisabledReason={agentSwitchDisabledReason}
    />
  ) : moreOpen ? (
    <TerminalMoreSheet
      onClose={() => setMoreOpen(false)}
      onExplain={projectKey && activeTab ? explainer.ask : undefined}
      immersive={immersive}
      onToggleImmersive={onToggleImmersive}
      font={font}
      columns={geometry?.cols ?? null}
      liveKeys={deck.liveKeys}
      onLiveKeysChange={deck.setLiveKeys}
    />
  ) : null;

  // Sit the chrome on top of the soft keyboard instead of under it. See
  // useKeyboardInset: the layout viewport does not shrink when the keyboard
  // opens, so without this the key deck is drawn behind the keys.
  const rootStyle = keyboardInset ? { paddingBottom: keyboardInset } : undefined;

  // ── Server shell ────────────────────────────────────────────────────────
  // Its own PTYs, its own tabs and splits — but rendered with the same chrome,
  // so the only thing that changes is what is inside the panes.
  if (source === "shell") {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2" style={rootStyle}>
        {sourceBar}
        <div className="md:hidden">{mobileHeader}</div>
        <div className="min-h-0 flex-1">
          <ShellWorkspace />
        </div>
        {sheet}
      </div>
    );
  }

  // ── Agent sessions ──────────────────────────────────────────────────────
  const body = () => {
    // The Resume rows' common half: the empty state lists every project, a
    // missed deep link only the one it named.
    const resume = {
      projects: context?.launchable ?? [],
      agents,
      defaultAgent: context?.agents.defaultAgent ?? null,
      channel,
      openTabs: tabs,
      onStarted: setUserSelection,
    };
    // A miss while the builder is offline or gated is not a miss: "Start it,
    // and it opens here" is false when nothing can start. The empty state
    // below says the builder is down and offers the way forward (owner, on a
    // second computer, 2026-10-12: "classic dead end").
    if (deepLinkMiss && !offline && !gatedMessage) {
      return (
        <TerminalSessionMiss
          resume={resume}
          requestedTab={resolvedInitialTab!}
          openSessions={stripTabs.map((t) => ({
            id: t.id,
            label: t.label,
            detail: t.status ? SESSION_STATUS_WORDS[t.status] : null,
          }))}
          onOpenSession={setUserSelection}
        />
      );
    }
    if (loading && tabs.length === 0) {
      return (
        <div className="flex items-center gap-2 p-6 text-sm text-text-muted">
          <Loader2 className="ui-spinner" /> {copy.loading}
        </div>
      );
    }
    if (tabs.length === 0) {
      // Three honest states, in priority order: gated (this account may not use
      // this builder) → offline (allowed, nothing connected) → online-but-idle
      // (allowed and connected, just nothing running → offer the next step).
      // A deep link ?tab=X with nothing open lists X first among the Resume
      // rows (emptyStateProject), so it needs no sentence of its own.
      const hint = gatedMessage ?? emptyStateHint({ offline, source, presence, tabHint: null });
      // `initialTab` is the ATTACHED tab, which is null on exactly this
      // screen — nothing is running, that is why the empty state renders. Fall
      // back to the workspace project so these two buttons keep the scope the
      // Profile/Chat/Control/Terminal strip is showing directly above them.
      const emptyStateProject = initialTab ?? fleetProject;
      if (!gatedMessage && !offline) {
        // Allowed and connected, nothing open: what you had, one tap from
        // each — not a form that read as if it never existed.
        // One line and a row per project; where they run is a menu on the
        // line, only when there is a choice. It said "Nothing is open on the
        // cloud builder. Pick up where you left off:" over a boxed list, under
        // a second header naming the builder (owner, 2026-10-21).
        const runsOn = TERMINAL_SOURCES.filter((s) => sources.includes(s.id));
        return (
          <div className="ui-term-empty">
            <SectionHeading
              title="Pick up where you left off"
              right={
                runsOn.length > 1 ? (
                  <ChoiceMenu
                    label="On"
                    value={source}
                    options={runsOn.map((s) => ({ value: s.id, label: s.label, hint: s.hint }))}
                    onChange={setSource}
                  />
                ) : undefined
              }
            />
            <TerminalResume
              {...resume}
              activeProject={emptyStateProject}
              onAllProjects={launchProps ? () => setNewSessionOpen(true) : undefined}
            />
          </div>
        );
      }
      return (
        // Gated or offline: the one sentence that says why, and the way on.
        <EmptyState
          icon={MonitorSmartphone}
          title={hint}
          size="lg"
          action={
            <TerminalOfflineActions source={source} presence={presence} onSwitch={setSource} />
          }
        />
      );
    }
    // A source switch can briefly leave the previous source's selected tab in
    // state while the new source already has a different tab list. Rendering
    // TerminalView in that gap used to pass a null transport and crash on
    // `transport.key`. Keep the page usable and explain what is settling.
    if (!activeTab || !transport) {
      return (
        <div className="ui-empty-page">
          <Loader2 className="ui-spinner h-5 w-5" aria-hidden="true" />
          <p className="text-sm text-text-secondary">Opening the session…</p>
        </div>
      );
    }
    if (view === "chat") {
      return (
        <ClaudeChatView
          key={`chat:${channel}:${activeTab}`}
          tab={activeTab}
          channel={channel}
          onLive={setLiveState}
          onKey={sendReported}
          onShowTerminal={termView.showTerminal}
          onExplain={projectKey ? explainer.ask : undefined}
          draft={sessionDraft}
          project={projectKey}
          onUnavailable={() =>
            setNoTranscript((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)))
          }
        />
      );
    }
    return (
      <TerminalView
        key={`${channel}:${activeTab}`}
        transport={transport}
        fill
        // Live keystrokes (on by default on a computer, off on a phone, where
        // a soft keyboard fights a terminal canvas): pressing the screen gives
        // it the keyboard. Off, pressing it puts the cursor in the session box.
        interactive={deck.liveKeys}
        onActivate={deck.liveKeys ? undefined : writeToSession}
        compactChrome={immersive}
        stalledHint={copy.stalledHint}
        font={font}
        onLive={setLiveState}
        onGeometry={setGeometry}
        actions={paneActions}
        readScreenRef={readScreenRef}
        onShowChat={chatAvailable ? () => termView.setView("chat") : undefined}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" style={rootStyle}>
      {sourceBar}
      {/* With nothing open the app's own top bar names the page, and the
          list below is the way in: a second header saying "Cloud builder ·
          4 sessions" over it was a second title (owner, 2026-10-21). */}
      {activeTab && <div className="md:hidden">{mobileHeader}</div>}
      <TerminalAgentTabs
        tabs={stripTabs}
        activeTab={activeTab}
        onSelect={setUserSelection}
        layout={ta.layout}
        setLayout={ta.setLayout}
        onRename={(id, name) =>
          ta.rename(id, name, stripTabs.find((t) => t.id === id)?.original ?? id)
        }
        onClose={(id) => void ta.closeTab(id)}
        launch={launchProps}
        launchOpen={ta.launchOpen}
        setLaunchOpen={ta.setLaunchOpen}
        error={ta.actionError}
      />
      <TerminalSessionNotice news={news} tabs={stripTabs} onOpen={setUserSelection} />
      {activeTab && (
        <div className="hidden md:block">
          <TerminalSessionBar
            agents={agents}
            activeAgentId={activeAgentId}
            onSwitchAgent={(id) => void ta.switchAgent(id)}
            switchingAgent={ta.switchingAgent}
            agentSwitchDisabledReason={agentSwitchDisabledReason}
            view={view}
            onViewChange={chatAvailable ? termView.setView : undefined}
          />
        </div>
      )}
      <div className="ui-term-split">
        <div className="ui-term-split-pty">{body()}</div>
        {/* Expanded means the session gets the whole screen — the rail is
            one click away again on the way out. */}
        {railShown && (
          <div className="ui-term-split-rail" aria-label="Loki comments and inject">
            {renderLokiRail("rail")}
          </div>
        )}
      </div>

      {activeTab && view === "terminal" && (
        <TerminalActions readScreenRef={readScreenRef} agent={activeAgentId} onKey={sendKey} />
      )}

      {/* ONE box for the agent, at every width — the same SessionComposer the
          conversation view shows. Microphone, screenshots and the prompt
          library are in it; "What's going on?" is the first chip above it;
          the keys a phone lacks are one button in its tool row. */}
      {activeTab && view === "terminal" && (
        <TerminalMobileDock
          onKey={sendKey}
          keysOpen={keysOpen}
          onKeysOpenChange={setKeysOpen}
          immersive={immersive}
          session={{ tab: activeTab, channel, agent: activeAgentId, onKey: sendReported }}
          box={(tools) => (
            <SessionComposer
              tab={activeTab}
              channel={channel}
              onKey={sendReported}
              live={liveState === "live"}
              agent={activeAgentId}
              agentLabel={headerAgent ?? "the agent"}
              // Keys open is a person driving the screen: the next-step row
              // steps aside so the terminal keeps its lines (it was three
              // rows tall under the deck, the chips and the box).
              // At most two, so the row stays one line above the box.
              suggestions={keysOpen ? [] : screenNext.steps.slice(0, 2)}
              offerFeedback={!keysOpen && screenNext.asksForFeedback}
              project={projectKey}
              onExplain={projectKey && !keysOpen ? explainer.ask : undefined}
              draft={sessionDraft}
              focusRequest={focusRequest}
              density={immersive ? "compact" : "comfortable"}
              tools={tools}
              onOpenKeys={() => setKeysOpen(true)}
            />
          )}
        />
      )}

      {sheet}
      {newSessionOpen && launchProps && (
        <TerminalNewSessionSheet {...launchProps} onClose={() => setNewSessionOpen(false)} />
      )}
      {explainer.sheetOpen && projectKey && (
        <TerminalLokiSheet onClose={() => explainer.setSheetOpen(false)}>
          {renderLokiRail("sheet")}
        </TerminalLokiSheet>
      )}
    </div>
  );
}
