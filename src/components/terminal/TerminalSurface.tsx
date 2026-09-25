"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Maximize2, Minimize2, MonitorSmartphone, PanelRight } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { deriveExecutorHonestyLabel } from "@/lib/executor-honesty";
import { useFetch } from "@/hooks/use-fetch";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
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
  type TerminalInputMode,
  type TerminalSource,
} from "@/config/terminal-modes";
import type { TerminalContext } from "@/app/api/terminal/context/route";
import { TerminalView } from "./TerminalView";
import { TerminalTabStrip } from "./TerminalTabStrip";
import { TerminalSessionBar, TerminalSourceBar } from "./TerminalModeBar";
import { TerminalComposer } from "./TerminalComposer";
import { TerminalLaunch } from "./TerminalLaunch";
import { TabVoiceMic } from "./TabVoiceMic";
import { ShellWorkspace } from "./ShellWorkspace";
import { TerminalSessionMiss } from "./TerminalSessionMiss";
import { TerminalMobileHeader, type TerminalLiveState } from "./TerminalMobileHeader";
import { TerminalSessionSheet } from "./TerminalSessionSheet";
import { TerminalMobileDock } from "./TerminalMobileDock";
import { TerminalLokiRail } from "./TerminalLokiRail";
import { Modal } from "@/components/ui/modal";
import { runnerTransport } from "./terminal-transport";
import { useTerminalTabs } from "./use-terminal-tabs";

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

const channelFor = (source: TerminalSource): BuilderChannel =>
  source === "machine" ? "local" : "cloud";

/** Comfortably under the 4000-byte cap the raw-key route enforces on one write.
 *  Multi-byte characters make length-in-chars an under-estimate of bytes, and
 *  halving the budget is cheaper than counting UTF-8 at every keystroke. */
const RAW_KEY_CHUNK = 1500;

type TerminalMode = { source: TerminalSource; input: TerminalInputMode };

const DEFAULT_MODE: TerminalMode = { source: "cloud", input: "type" };

// Module-level so their identity is stable across renders — useLocalStorageState
// keeps them in effect dependency arrays.
const serializeMode = (mode: TerminalMode) => JSON.stringify(mode);
const serializeRail = (open: boolean) => (open ? "1" : "0");
const deserializeRail = (raw: string) => raw !== "0";
const deserializeMode = (raw: string): TerminalMode => {
  try {
    const parsed = JSON.parse(raw) as Partial<TerminalMode>;
    return {
      source: parsed.source ?? DEFAULT_MODE.source,
      input: parsed.input ?? DEFAULT_MODE.input,
    };
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
 * Now the chrome is constant: tab strip, mode bar, session, composer. The
 * source picks which transport fills the session; the input mode picks what
 * happens to what you type. Nothing about navigating changes when you switch.
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

  const inputMode = mode.input;
  const setSource = (next: TerminalSource) => {
    setPickedSource(next);
    setMode((m) => ({ ...m, source: next }));
  };
  const setInputMode = (next: TerminalInputMode) => setMode((m) => ({ ...m, input: next }));

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
  const sendKey = useCallback(
    (bytes: string) => {
      if (!transport) return;
      void (async () => {
        for (let i = 0; i < bytes.length; i += RAW_KEY_CHUNK) {
          await transport.sendKey(bytes.slice(i, i + RAW_KEY_CHUNK));
        }
      })();
    },
    [transport],
  );

  // Phone chrome state. Font and stream status are owned here rather than
  // inside TerminalView because the controls that read them now live outside
  // it — the header shows the live dot, the sheet steps the font.
  const font = useTerminalFont();
  const deck = useTerminalDeck();
  const keyboardInset = useKeyboardInset();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Auto-open the Loki sheet only where the rail is not beside the session.
  // Reusing one React element in both the split and the modal would unmount it
  // from the visible desktop pane (the modal is lg:hidden).
  const [lokiSheetOpen, setLokiSheetOpen] = useState(
    () =>
      Boolean(initialRunId) &&
      typeof window !== "undefined" &&
      !window.matchMedia(TERMINAL_RAIL_QUERY).matches,
  );
  // The rail beside the session (lg+). Closing it hands its columns to the
  // terminal; the choice is remembered, like the input mode.
  const [railOpen, setRailOpen] = useLocalStorageState<boolean>(
    TERMINAL_RAIL_STORAGE_KEY,
    true,
    serializeRail,
    deserializeRail,
  );
  // Whether the rail can sit beside the session at this width at all. Below
  // it the rail is a sheet, and the toggle opens that instead.
  const railFits = useMediaQuery(TERMINAL_RAIL_QUERY);
  const [liveState, setLiveState] = useState<TerminalLiveState>("connecting");
  const [geometry, setGeometry] = useState<PtyGeometry | null>(null);

  // Scope the chip to THIS source. Using any-builder `runnerConnected` on the
  // cloud tab labelled a laptop-only online state as "Cloud builder online",
  // and the inverse (null while presence loads) as "Cloud builder offline"
  // while the box was shipping. Live tabs are the tie-break when channels
  // disagree with presence — same rule as useTerminalTabs.offline.
  const channelOnline =
    source === "machine" ? presence.builderPresence?.local : presence.builderPresence?.cloud;
  const honesty =
    presence.builderPresence == null && tabs.length === 0
      ? null
      : deriveExecutorHonestyLabel(
          source === "machine"
            ? {
                runnerConnected: channelOnline ?? (tabs.length > 0 ? true : false),
                runtimeAvailable: false,
                scope: "machine",
              }
            : {
                runnerConnected: channelOnline ?? (tabs.length > 0 ? true : false),
                runtimeAvailable: local || presence.runtimeAvailable,
                scope: "cloud",
              },
        );

  // Agent roster derived from context (already fetched above for tab resolution)
  const agents = useMemo(
    () => (context?.agents.agents ?? []).filter((a) => a.switchable),
    [context],
  );
  const tabContext = context?.tabs.find((t) => t.tab === activeTab) ?? null;
  const activeAgentId = tabContext?.agentPref ?? context?.agents.defaultAgent ?? null;
  const projectKey = tabContext?.projectName ?? activeTab ?? initialTab ?? null;

  const [switchingAgent, setSwitchingAgent] = useState(false);
  const agentSwitchDisabledReason = !activeTab
    ? "Open a session first — switching swaps the CLI running in a tab."
    : !tabContext?.dir
      ? `“${activeTab}” isn’t linked to a project directory, so Loki doesn’t know where to relaunch the agent.`
      : null;

  // Capture the one field the callback needs as a local, so the closure
  // depends on `tabDir` — not the whole `tabContext` object — and the manual
  // deps match what the compiler infers.
  const tabDir = tabContext?.dir ?? null;
  const switchAgent = useCallback(
    async (agentId: string) => {
      if (!activeTab || !tabDir) return;
      setSwitchingAgent(true);
      try {
        await postJson("/api/control/switch-agent", {
          tab: activeTab,
          dir: tabDir,
          toAgent: agentId,
          ...(activeAgentId ? { fromAgent: activeAgentId } : {}),
        });
      } catch {
        /* the session itself remains the source of truth on screen */
      } finally {
        setSwitchingAgent(false);
      }
    },
    [activeTab, tabDir, activeAgentId],
  );

  // The strip tells the truth about each tab: the project it resolves to (by
  // name, or by pane cwd for generically named tabs) and the agent CLI actually
  // running in it — so "Tab #1 · claude" and "Tab #2 · grok" are distinguishable
  // without clicking through.
  const stripTabs = useMemo(
    () =>
      tabs.map((tab) => {
        const ctx = context?.tabs.find((t) => t.tab === tab);
        const badge = ctx?.liveAgents.length ? ctx.liveAgents.join("+") : undefined;
        const label = ctx?.projectName ?? tab;
        return {
          id: tab,
          label,
          badge,
          title: [label !== tab ? tab : null, badge].filter(Boolean).join(" — ") || undefined,
          dot: tab === activeTab ? "ui-dot-positive" : undefined,
        };
      }),
    [tabs, activeTab, context],
  );

  // Where we looked, and the one place we haven't — both named in the miss
  // state, since "not on Cloud" and "nowhere" are very different news.
  const sourceLabel =
    source === "machine"
      ? EXECUTOR_COPY.terminal.thisComputerLabel
      : EXECUTOR_COPY.terminal.cloudLabel;
  const otherSourceLabel =
    source === "machine"
      ? sources.includes("cloud")
        ? EXECUTOR_COPY.terminal.cloudLabel
        : null
      : sources.includes("machine")
        ? EXECUTOR_COPY.terminal.thisComputerLabel
        : null;

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
  const headerTitle =
    source === "shell"
      ? "Shell"
      : (stripTabs.find((t) => t.id === activeTab)?.label ?? activeTab ?? sourceLabel);
  const headerAgent =
    source === "shell" ? null : (stripTabs.find((t) => t.id === activeTab)?.badge ?? null);
  const headerState: TerminalLiveState = !activeTab && source !== "shell" ? "idle" : liveState;

  const mobileHeader = (
    <TerminalMobileHeader
      title={headerTitle}
      agent={headerAgent}
      state={headerState}
      onOpenSheet={() => setSheetOpen(true)}
      onOpenLoki={projectKey ? () => setLokiSheetOpen(true) : undefined}
      immersive={immersive}
      onToggleImmersive={onToggleImmersive ?? (() => {})}
    />
  );

  // New element per call — never reuse one descriptor in the split AND the sheet.
  const renderLokiRail = () =>
    projectKey ? (
      <TerminalLokiRail
        project={projectKey}
        tab={activeTab}
        runId={initialRunId}
        ptyLive={liveState === "live"}
        projectId={tabContext?.projectId ?? null}
        canSwitchAgent={!agentSwitchDisabledReason}
        onSwitchAgent={(id) => void switchAgent(id)}
      />
    ) : null;

  // Pane controls, in the terminal's own status row (desktop). Where the rail
  // cannot sit beside the session (md–lg) the same button opens it as a sheet,
  // so the panel is one click away at every width instead of only on lg+.
  const railShown = Boolean(projectKey) && railOpen && railFits && !immersive;
  const toggleRail = () => {
    if (railFits) setRailOpen((open) => !open);
    else setLokiSheetOpen(true);
  };
  const paneActions = (
    <>
      {projectKey && !immersive && (
        <button
          type="button"
          className={railShown ? "ui-term-pane-btn ui-term-pane-btn-on" : "ui-term-pane-btn"}
          onClick={toggleRail}
          aria-pressed={railFits ? railShown : undefined}
          aria-label={railShown ? "Hide the Loki panel" : "Show the Loki panel"}
          title={
            railShown ? "Hide the Loki panel — the terminal takes the width" : "Show the Loki panel"
          }
        >
          <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
          Loki
        </button>
      )}
      {onToggleImmersive && (
        <button
          type="button"
          className={immersive ? "ui-term-pane-btn ui-term-pane-btn-on" : "ui-term-pane-btn"}
          onClick={onToggleImmersive}
          aria-pressed={immersive}
          aria-label={immersive ? "Leave full screen (Esc)" : "Expand terminal to full screen"}
          title={immersive ? "Leave full screen (Esc)" : "Expand to full screen"}
        >
          {immersive ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      )}
    </>
  );

  const sheet = sheetOpen ? (
    <TerminalSessionSheet
      onClose={() => setSheetOpen(false)}
      source={source}
      sources={sources}
      onSourceChange={setSource}
      // The shell substrate owns its own tabs and splits, and runs no agent —
      // so it gets the source and display sections and none of the per-session
      // ones. Passing the agent path's activeTab through would offer to switch
      // the agent in a session the shell is not showing.
      tabs={source === "shell" ? undefined : stripTabs}
      activeTab={source === "shell" ? null : activeTab}
      onSelectTab={source === "shell" ? undefined : setUserSelection}
      inputMode={inputMode}
      onInputModeChange={setInputMode}
      agents={agents}
      activeAgentId={activeAgentId}
      onSwitchAgent={(id) => void switchAgent(id)}
      switchingAgent={switchingAgent}
      agentSwitchDisabledReason={agentSwitchDisabledReason}
      honesty={honesty}
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
    if (deepLinkMiss) {
      return (
        <TerminalSessionMiss
          requestedTab={resolvedInitialTab!}
          sourceLabel={sourceLabel}
          otherSourceLabel={otherSourceLabel}
          available={tabs}
          onAttach={setUserSelection}
          onSwitchSource={() => setSource(source === "machine" ? "cloud" : "machine")}
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
      // Deep link ?tab=X with no session is the common Install/Implement Watch
      // dead-end — say so plainly instead of a generic empty cloud.
      const tabHint =
        initialTab && !offline && !gatedMessage
          ? // Name the button Attention ACTUALLY shows for this case. This branch
            // is the no-running-agent case by definition, which maps to
            // START_SESSION — Retry is deliberately not offered there, because
            // repeating a command against an absent target fails identically
            // forever. The old copy said "Retry", so it sent the reader to
            // Control to hunt for a button that is not drawn.
            `No live session for “${initialTab}”. If you just dispatched work, check its status in Control. Start a session here when you want to launch an agent directly.`
          : null;
      const hint = gatedMessage ?? (offline ? copy.offlineHint : (tabHint ?? copy.emptyHint));
      // `initialTab` is the ATTACHED tab, which is null on exactly this
      // screen — nothing is running, that is why the empty state renders. Fall
      // back to the workspace project so these two buttons keep the scope the
      // Profile/Chat/Control/Terminal strip is showing directly above them.
      const emptyStateProject = initialTab ?? fleetProject;
      const controlHref = fleetSurfaceHref("control", emptyStateProject);
      const chatHref = fleetSurfaceHref("chat", emptyStateProject);
      return (
        <div className="ui-empty-page">
          <MonitorSmartphone className="h-6 w-6 text-text-muted" aria-hidden="true" />
          <p className="text-sm text-text-secondary">
            {offline ? copy.empty.replace("right now", "— builder offline") : copy.empty}
          </p>
          <p className="max-w-md text-center text-xs text-text-muted">{hint}</p>
          {!gatedMessage && !offline && (
            <>
              <TerminalLaunch
                projects={context?.launchable ?? []}
                agents={agents}
                defaultAgent={context?.agents.defaultAgent ?? null}
                activeProject={emptyStateProject}
                channel={channel}
              />
              <div className="mt-1 flex flex-wrap justify-center gap-x-1 text-xs text-text-muted">
                <span>Want help planning first?</span>
                <Link href={chatHref} className="underline underline-offset-2">
                  Ask Loki
                </Link>
                <span aria-hidden="true">·</span>
                <Link href={controlHref} className="underline underline-offset-2">
                  Manage the project in Control
                </Link>
              </div>
            </>
          )}
        </div>
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
          <p className="text-sm text-text-secondary">Selecting an available session…</p>
          <p className="max-w-md text-center text-xs text-text-muted">
            Loki is reconciling the sessions reported by {sourceLabel}. This page will attach
            automatically; you do not need to retry.
          </p>
        </div>
      );
    }
    return (
      <TerminalView
        key={`${channel}:${activeTab}`}
        transport={transport}
        fill
        // Only Type mode captures keystrokes, and only where the operator
        // actually wants the canvas to have the keyboard. In Prompt and Voice
        // mode — and on a phone by default, where typing happens in the dock's
        // composer — the session stays readable and the page keeps its own
        // keyboard, so Alt+N tab switching and the composer are not swallowed
        // by the PTY.
        interactive={inputMode === "type" && deck.liveKeys}
        compactChrome={immersive}
        stalledHint={copy.stalledHint}
        font={font}
        onLive={setLiveState}
        onGeometry={setGeometry}
        actions={paneActions}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" style={rootStyle}>
      {sourceBar}
      <div className="md:hidden">{mobileHeader}</div>
      <div className="hidden md:block">
        <TerminalTabStrip tabs={stripTabs} activeId={activeTab} onSelect={setUserSelection} />
      </div>
      {activeTab && (
        <div className="hidden md:block">
          <TerminalSessionBar
            inputMode={inputMode}
            onInputModeChange={setInputMode}
            agents={agents}
            activeAgentId={activeAgentId}
            onSwitchAgent={(id) => void switchAgent(id)}
            switchingAgent={switchingAgent}
            agentSwitchDisabledReason={agentSwitchDisabledReason}
          />
        </div>
      )}
      <div className="ui-term-split">
        <div className="ui-term-split-pty">{body()}</div>
        {/* Expanded means the session gets the whole screen — the rail is
            one click away again on the way out. */}
        {railShown && (
          <div className="ui-term-split-rail" aria-label="Loki comments and inject">
            {renderLokiRail()}
          </div>
        )}
      </div>

      {/* Desktop composers. The phone's live in the dock below, alongside the
          key deck, so there is exactly one stack of controls under the screen
          rather than a composer here and a keyboard somewhere else. While the
          Loki rail is beside the session its Inject IS the prompt composer —
          the same component — so a second copy under the terminal would be
          two boxes on one screen for one job. */}
      {activeTab && inputMode === "prompt" && !railShown && (
        <div className="hidden md:block">
          <TerminalComposer tab={activeTab} />
        </div>
      )}
      {activeTab && inputMode === "voice" && (
        <div className="hidden shrink-0 items-center md:flex">
          <TabVoiceMic tab={activeTab} channel={channel} compact={immersive} />
        </div>
      )}

      {activeTab && (
        <TerminalMobileDock
          tab={activeTab}
          channel={channel}
          inputMode={inputMode}
          onKey={sendKey}
          liveKeys={deck.liveKeys}
          immersive={immersive}
        />
      )}

      {sheet}
      {lokiSheetOpen && projectKey && (
        <div className="lg:hidden">
          <Modal
            onClose={() => setLokiSheetOpen(false)}
            position="bottom-mobile"
            size="lg"
            padded={false}
            className="ui-sheet"
          >
            <div className="ui-term-loki-sheet">{renderLokiRail()}</div>
          </Modal>
        </div>
      )}
    </div>
  );
}
