"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Play, TerminalSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/dates";
import { answer } from "@/lib/project-display";
import { postJson, patchJson } from "@/lib/api/fetch";
import type { ProjectState } from "@/lib/control-types";
import type { PromptMeta } from "@/lib/agent-config";
import type { OrchestrationTaskIntentId } from "@/lib/orchestration";
import {
  getProjectDisplayState,
  isProjectTabOpen,
  type ProjectOperationsSnapshot,
} from "./control-presenter";
import { ProjectProfile } from "./ProjectProfile";
import { LatestOrchestrationPanel } from "./project-card-helpers";
import { ProjectCardHeader, SessionSummary } from "./project-card-sections";
import { ProjectBanners } from "./project-card-banners";
import { ProjectActivitySection } from "./project-card-activity";
import { IntentButtonPanel } from "./project-intent-panel";
import { ProjectAutopilotToggle } from "./ProjectAutopilotToggle";
import { usePromptQueue } from "@/hooks/use-prompt-queue";
import { useAutoContinue } from "@/hooks/use-auto-continue";
import { useProjectLifecycleSync } from "@/hooks/use-project-lifecycle-sync";
import { useProjectCardActions } from "@/hooks/use-project-card-actions";
import type { AutoInjectMode } from "@/config/beacon";
import { CapacityIssueBanner } from "./CapacityIssueBanner";
import {
  detectCapacityIssueFromProject,
  resolveNextFallbackAgent,
  resolveOutgoingAgent,
} from "@/lib/agent-resolution";
import {
  decideAutoReroute,
  shouldShowManualCapacityBanner,
  type AutoRerouteSkipReason,
} from "@/lib/auto-reroute";

export function ProjectCard({
  project,
  prompts,
  liveTabs,
  currentAdapter,
  availableAgents,
  agentOrder,
  onInject,
  onRunWithBrain,
  onRunCustomPrompt,
  onCollapse,
  onFocus,
  onLaunch,
  isOnlyReady = false,
  runtimeAvailable = true,
  runtimeStateKnown = true,
  runnerSyncStale = false,
  executionStalled = false,
  snapshot,
  automationMode = "on",
  countdownSeconds,
  nowS,
}: {
  project: ProjectState;
  prompts: PromptMeta[];
  liveTabs: string[];
  currentAdapter: string;
  availableAgents: { id: string; label: string; modelSuggestions: string[] }[];
  /** Operator's provider ranking; null = fleet default. See resolveNextFallbackAgent. */
  agentOrder?: string[] | null;
  onInject: (
    tab: string,
    promptKey?: string,
    customPrompt?: string,
  ) => Promise<{ commandId?: string | null } | void>;
  onRunWithBrain: (project: ProjectState, intent: OrchestrationTaskIntentId) => Promise<void>;
  onRunCustomPrompt: (project: ProjectState, prompt: string, agent: string) => Promise<void>;
  onCollapse?: () => void;
  onFocus?: () => void;
  onLaunch?: () => void;
  isOnlyReady?: boolean;
  runtimeAvailable?: boolean;
  runtimeStateKnown?: boolean;
  /** True when cloud view is showing last-known runner state (sync >90s old). */
  runnerSyncStale?: boolean;
  /** Builder is connected but not executing queued dispatches (fleet-wide).
   *  The card's autopilot copy must not claim an empty queue over it. */
  executionStalled?: boolean;
  snapshot?: ProjectOperationsSnapshot;
  automationMode?: AutoInjectMode;
  countdownSeconds?: number;
  /** Parent-render clock (unix seconds) — one Date.now() per render tree, so
   *  the card's staleness math matches the snapshots' (and render stays pure). */
  nowS: number;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [localAgent, setLocalAgent] = useState<string | null>(project.agentPref ?? null);
  const [switchingAgent, setSwitchingAgent] = useState(false);
  const [capacityDismissed, setCapacityDismissed] = useState(false);

  const installedAgentIds = availableAgents.map((a) => a.id);
  const outgoingAgent = resolveOutgoingAgent(project, localAgent);
  const capacityIssue = detectCapacityIssueFromProject(project);
  const suggestedFallback = resolveNextFallbackAgent(
    outgoingAgent,
    installedAgentIds,
    agentOrder ?? undefined,
  );

  // A (re)appearing capacity issue or a new session state re-arms the banner.
  // Guarded render-time adjustment (React's "adjusting state when props
  // change" pattern) instead of an effect.
  const capacityResetSignature = `${capacityIssue}:${project.session?.mtime ?? ""}:${project.currentPrompt?.label ?? ""}`;
  const [prevCapacityResetSignature, setPrevCapacityResetSignature] =
    useState(capacityResetSignature);
  if (capacityResetSignature !== prevCapacityResetSignature) {
    setPrevCapacityResetSignature(capacityResetSignature);
    if (capacityIssue) setCapacityDismissed(false);
  }

  const performAgentSwitch = async (agentId: string) => {
    const currentAgent = resolveOutgoingAgent(project, localAgent);
    setLocalAgent(agentId);
    if (project.id) {
      patchJson(`/api/user-projects/${project.id}`, { agentPref: agentId }).catch(() => {});
    }
    const workspaceTab = project.liveTab ?? project.tab;
    const tabIsOpen = isProjectTabOpen(project, liveTabs);
    if (agentId === currentAgent || !tabIsOpen || !project.dir) return;

    setSwitchingAgent(true);
    try {
      await postJson("/api/control/switch-agent", {
        tab: workspaceTab,
        dir: project.dir,
        toAgent: agentId,
        fromAgent: currentAgent ?? undefined,
      });
    } catch {
      /* best effort */
    } finally {
      setSwitchingAgent(false);
    }
  };

  const handleSwitchAgent = async (agentId: string | null) => {
    if (!agentId) {
      setLocalAgent(null);
      if (project.id) {
        patchJson(`/api/user-projects/${project.id}`, { agentPref: undefined }).catch(() => {});
      }
      return;
    }
    await performAgentSwitch(agentId);
  };

  // ── Auto-reroute ────────────────────────────────────────────────────────
  // Under autopilot, hitting a capacity wall is a judgment-free step: switch to
  // the next installed agent ourselves instead of waiting for a human click.
  // Loop safety: AGENT_FALLBACK_ORDER cycles (grok→claude), so we track which
  // agents we've already auto-tried THIS episode and stop (surfacing a manual
  // banner) once exhausted rather than churning. We act once per distinct
  // session state (mtime + outgoing agent) so a switch landing — which lags the
  // session poll — doesn't re-trigger or flash a false "exhausted".
  const autopilotOn = automationMode === "on";
  const tabOpen = isProjectTabOpen(project, liveTabs);
  const autoTriedAgentsRef = useRef<Set<string>>(new Set());
  const handledCapacitySignatureRef = useRef<string | null>(null);
  const [autoRerouteReason, setAutoRerouteReason] = useState<AutoRerouteSkipReason | null>(null);

  useEffect(() => {
    if (!capacityIssue) {
      autoTriedAgentsRef.current.clear();
      handledCapacitySignatureRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Episodic automation: this effect reacts to polled session state and must reset/record the reroute banner exactly once per capacity episode (ref-tracked signature + tried-agent set as loop guards). Deriving that state during render would rewire the loop-safety guarantees of a live agent-switching path for no user-visible gain.
      setAutoRerouteReason(null);
      return;
    }
    const signature = `${project.session?.mtime ?? ""}:${outgoingAgent ?? ""}`;
    if (signature === handledCapacitySignatureRef.current) return;
    handledCapacitySignatureRef.current = signature;

    const decision = decideAutoReroute({
      capacityIssue,
      automationOn: autopilotOn,
      tabOpen,
      switchInFlight: switchingAgent,
      suggestedFallback,
      triedAgents: autoTriedAgentsRef.current,
    });
    if (decision.reroute) {
      autoTriedAgentsRef.current.add(decision.toAgent);
      setAutoRerouteReason(null);
      void performAgentSwitch(decision.toAgent);
    } else {
      setAutoRerouteReason(decision.reason);
    }
    // performAgentSwitch is a stable closure over component state; the primitive
    // deps below capture every signal that should re-run the decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    capacityIssue,
    autopilotOn,
    tabOpen,
    switchingAgent,
    suggestedFallback,
    project.session?.mtime,
    outgoingAgent,
  ]);

  // Autopilot is actively switching (or about to) — distinct from "can't act"
  // skips like tab-closed, which surface no banner at all.
  const autoRerouteHandling =
    autopilotOn &&
    capacityIssue &&
    (autoRerouteReason === null || autoRerouteReason === "switch-in-flight");

  const [dismissed, setDismissed] = useState(false);
  const { enabled: autoContinueEnabled, toggle: toggleAutoContinue } = useAutoContinue(
    project.tab,
    project.autoContinueEnabled,
  );
  const {
    queue,
    enqueue,
    remove: removeFromQueue,
    reorder: reorderInQueue,
    edit: editInQueue,
    clear: clearQueue,
    mergeItems: mergeItemsInQueue,
  } = usePromptQueue(project.tab, project.promptQueue, project.promptQueueRevision);

  // Reset dismissed each time a new agent run begins so the ready banner fires
  // once per cycle. Guarded render-time adjustment on the running transition.
  const [prevAgentRunning, setPrevAgentRunning] = useState(project.agentRunning);
  if (project.agentRunning !== prevAgentRunning) {
    setPrevAgentRunning(project.agentRunning);
    if (project.agentRunning) setDismissed(false);
  }

  const display = dismissed
    ? getProjectDisplayState(project, liveTabs, nowS, true, runtimeStateKnown, runnerSyncStale)
    : (snapshot?.display ??
      getProjectDisplayState(project, liveTabs, nowS, false, runtimeStateKnown, runnerSyncStale));
  const isReadyNow = display.isReady || display.isOrchestrationReady;
  useProjectLifecycleSync(project.tab, isReadyNow);
  // After the 2026-06-11 collapse autopilot is binary. "on" continues when
  // the agent self-reports ready; "off" never does. The queue is drained
  // head-first; nextbest fills in when the queue runs dry. Auto-continue
  // remains a per-project pause/resume toggle independent of the mode.
  const automaticContinuationEnabled = autoContinueEnabled && automationMode === "on";
  // The card's "next" line, with its source named. Handoff (dated, written by
  // the agent when it stopped) beats the profile's undated LLM next_step.
  const handoffNext = project.session?.next?.trim();
  // answer(), not .trim(): the enricher writes literal "Unknown" into unfilled
  // attributes, and a card that prints "Next: Unknown" is worse than no line.
  const profileNext = answer(project.profile?.attrs?.["next_step"]);
  const handoffAgeLabel = project.session?.mtime ? timeAgo(project.session.mtime) : null;
  const nextStep = handoffNext
    ? {
        text: handoffNext,
        label: handoffAgeLabel ? `Next (agent, ${handoffAgeLabel}):` : "Next (agent):",
        sourceTitle: "From this project's latest agent handoff.",
      }
    : profileNext
      ? {
          text: profileNext,
          label: "Suggested next (profile):",
          sourceTitle: "From the project profile — written during enrichment, not by a recent run.",
        }
      : null;
  const tabOpenUntracked = display.tone === "idle" && display.tabOpen && !display.isRunning;
  const automationStatusLabel = tabOpenUntracked
    ? "Tab open on your computer — focus the workspace to check the agent, or send a prompt below."
    : automationMode === "off"
      ? "Autopilot off: this project waits for your instruction."
      : !autoContinueEnabled
        ? "Automatic continuation paused for this project."
        : queue.length > 0
          ? "Autopilot on: the next queued instruction will send when the agent waits."
          : // "Queue" here is the PROMPT queue only. Saying "queue is empty"
            // while dispatches sit unexecuted in pending_commands contradicted
            // the hero's own stall banner one screen up.
            executionStalled
            ? "Autopilot on, but dispatches are queued and not executing — see the builder status above."
            : "Autopilot on: queue is empty, so Loki picks the next-best task when the agent waits.";

  const {
    sending,
    justSent,
    custom,
    setCustom,
    customFocused,
    setCustomFocused,
    merging,
    sendError,
    clearSendError,
    dispatchStatus,
    clearDispatchStatus,
    sendCustom,
    sendText,
    sessionHealthBlocksQueue,
    sendIntent,
    send,
    handleAutoInject,
    handleSendFromQueue,
    handleMergeQueue,
  } = useProjectCardActions({
    project,
    queue,
    removeFromQueue,
    clearQueue,
    onInject,
    onRunWithBrain,
    setDismissed,
    isReadyNow,
    prompts,
    isOnlyReady,
    autoContinueEnabled: automaticContinuationEnabled,
  });

  const latestOrchRun = project.latestOrchestrationRun;
  const showPreviousRunPanel = display.showLatestOrchestration && !display.tabOpen;
  const queueBlockedReason =
    sessionHealthBlocksQueue() && queue.length > 0
      ? project.session?.health?.toLowerCase().includes("critical")
        ? "Health critical"
        : "Tests failing"
      : null;
  const paused =
    !automaticContinuationEnabled ||
    customFocused ||
    custom.trim().length > 0 ||
    display.isBeaconActive;

  // Smart "send to queue" (user request #2):
  // - If the project is currently idle/ready (nothing being done), treat the
  //   queue action as an immediate send (fills the ready slot right now).
  // - Otherwise, add to the persistent prompt_queue so it gets injected
  //   automatically once the current task finishes (via handleAutoInject etc.).
  // This unifies "type or pick from library/history → send to queue".
  // Works for both the textarea (Alt+Enter) and the ListPlus button, and
  // the mic "enqueue after recording" path (via onEnqueueCustom).
  const smartEnqueue = useCallback(
    (text: string) => {
      const trimmed = (text || "").trim();
      if (!trimmed) return;

      // Special case for deliberate handoff-controlled prompts the user pastes
      // (e.g. starting with "status: working" + full task). These should almost
      // always go direct so the user can drive the agent intentionally.
      const isHandoffControl = /^status:\s*(working|ready)/i.test(trimmed);

      if (isHandoffControl) {
        sendText(trimmed);
        return;
      }

      const idle =
        !project.agentRunning &&
        !display.isRunning &&
        (isReadyNow || display.tone === "idle" || display.isReady || display.isOrchestrationReady);
      if (idle) {
        sendText(trimmed);
      } else {
        enqueue(trimmed);
      }
    },
    [
      enqueue,
      sendText,
      project.agentRunning,
      display.isRunning,
      display.tone,
      isReadyNow,
      display.isReady,
      display.isOrchestrationReady,
    ],
  );

  return (
    <div
      className={cn(
        "ui-card-shell-raised overflow-hidden",
        display.isClosed
          ? "border-status-positive/30 bg-status-positive/[0.02]"
          : display.isClosing
            ? "border-status-warning/25 bg-status-warning/[0.02]"
            : display.isReady || display.isOrchestrationReady
              ? "border-status-positive/40 bg-status-positive/[0.03]"
              : display.isSessionOpen
                ? "border-accent-primary/25 bg-accent-primary/[0.02]"
                : "border-border-subtle bg-surface-base",
      )}
    >
      {capacityIssue &&
        suggestedFallback &&
        (autoRerouteHandling ? (
          <CapacityIssueBanner
            currentAgentId={outgoingAgent ?? project.agentPref ?? "claude"}
            nextAgentId={suggestedFallback}
            auto
            onSwitch={() => {}}
          />
        ) : !capacityDismissed && shouldShowManualCapacityBanner(autopilotOn, autoRerouteReason) ? (
          <CapacityIssueBanner
            currentAgentId={outgoingAgent ?? project.agentPref ?? "claude"}
            nextAgentId={suggestedFallback}
            switching={switchingAgent}
            exhausted={autopilotOn && autoRerouteReason === "all-tried"}
            onSwitch={() => performAgentSwitch(suggestedFallback)}
            onDismiss={() => setCapacityDismissed(true)}
          />
        ) : null)}

      {/* Honest dispatch status — the REAL lifecycle of the last queued
          dispatch (queued → picked up → ran / failed / unconfirmed), polled
          from the command row. Replaces the old silent "it 200'd, assume it's
          working" gap where a runner command failure never reached the card.

          UX audit gap (2026-08-19): this banner told the operator the truth
          but gave them nowhere to go act on it — a dismiss (X) was the only
          button. "Queued — runs when it's online" with no link reads as a
          dead end on a phone, where the live terminal panel below isn't even
          rendered (desktop/local-runtime only). Watch → now goes straight to
          this project's session on /terminal, same destination Loki's own
          dispatch footer already offers. */}
      {dispatchStatus && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-xs",
            dispatchStatus.tone === "negative"
              ? "border-status-negative/25 bg-status-negative/[0.05] text-status-negative"
              : dispatchStatus.tone === "warning"
                ? "border-status-warning/25 bg-status-warning/[0.05] text-status-warning"
                : dispatchStatus.tone === "positive"
                  ? "border-status-positive/25 bg-status-positive/[0.03] text-text-secondary"
                  : "border-border-subtle bg-surface-base text-text-secondary",
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="font-medium">{dispatchStatus.label}</span>
            {dispatchStatus.detail && (
              <span className="text-text-tertiary"> — {dispatchStatus.detail}</span>
            )}
          </span>
          <Link
            href={`/terminal?project=${encodeURIComponent(project.tab)}`}
            className="ui-dispatch-watch-link shrink-0"
          >
            <TerminalSquare className="h-3.5 w-3.5" />
            Watch
          </Link>
          {dispatchStatus.terminal && (
            <button
              onClick={clearDispatchStatus}
              aria-label="Dismiss dispatch status"
              className="ui-btn-icon shrink-0"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <ProjectCardHeader
        project={project}
        tabOpen={display.tabOpen}
        isReady={display.isReady}
        isOrchReady={display.isOrchestrationReady}
        isRunning={display.isRunning}
        stateKey={display.stateKey}
        stateLabel={display.stateLabel}
        stateTagClass={display.stateTagClass}
        evidenceLabel={snapshot?.evidenceLabel}
        evidenceAt={snapshot?.evidenceAt}
        evidenceKind={snapshot?.evidenceKind}
        profileOpen={profileOpen}
        onProfileToggle={() => setProfileOpen((v) => !v)}
        onCollapse={onCollapse}
        onFocus={onFocus}
        availableAgents={availableAgents}
        localAgentId={localAgent}
        switchingAgent={switchingAgent}
        onSwitchAgent={handleSwitchAgent}
        runtimeStateKnown={runtimeStateKnown}
      />

      {/* Per-project autopilot pause/resume. Hidden when no entity id is
          available (legacy paths-only projects can't be overridden — see
          ProjectAutopilotToggle for the rationale). */}
      <div className="px-4 pt-2 sm:px-5 md:px-6">
        <ProjectAutopilotToggle
          projectId={project.projectId}
          currentOverride={project.autoInjectModeOverride}
          inheritedMode={automationMode}
        />
        {/* What pressing play is FOR — visible without opening the profile.
            Play/pause means nothing if you can't see what the fleet intends
            to do next. Clicking it puts the step into the composer.

            TWO sources claim "next", and they disagree: the agent's own
            handoff (dated, written when it stopped) and the profile's
            next_step (LLM-generated during enrich, UNDATED). This line used
            to show the profile attr unconditionally — petvity advertised
            "configure GOOGLE_CLIENT_ID…" from a months-old enrich while the
            agent's handoff said something else entirely and 7 real dispatches
            that day ignored both. The agent's handoff wins when there is one,
            and each source is NAMED so a suggestion can't pass as a fact.

            line-clamp-3, NOT truncate. `truncate` is one line with an ellipsis,
            so this rendered as "Suggested next (profile): Conduct a 1-month
            baseline m…" — measured on prod, 594 of its 644 pixels hidden at
            390px and 432 at 1440px. The rest of the sentence existed only in
            the `title` tooltip, and a phone has no hover; OutcomeStreak.tsx in
            this same directory documents having already fixed that exact
            mistake for its glyph row. It costs more here than there: clicking
            this button loads the text into the composer, so the sentence IS
            the decision, and a tenth of a sentence is not one.

            NO `block` HERE, AND THAT IS THE WHOLE POINT. `-webkit-line-clamp`
            does nothing unless the box is `display: -webkit-box`, which the
            line-clamp utility sets — and Tailwind's `block` utility overrode
            it. The first version of this fix shipped `block ... line-clamp-2`
            and computed to `display: block; -webkit-line-clamp: 2`: the clamp
            was INERT. It looked fixed because the text then wrapped freely,
            which reads fine until the sentence is long. Checked live in a
            browser: a 460-character next_step grew this box from 48px to 96px
            and pushed the composer — the thing you act with — off the bottom
            of the viewport. So a green "it renders fully now" was measuring
            the absence of a clamp, not its presence.

            Three lines, not two: a typical next_step (~256 chars) reads in
            full at this width, and a pathological one is bounded and still
            reachable — clicking loads the whole text into the composer. */}
        {nextStep && (
          <button
            type="button"
            onClick={() => setCustom(nextStep.text)}
            className="ui-link-subtle-button mt-1.5 w-full px-0 text-left line-clamp-3"
            title={`${nextStep.text}\n\n${nextStep.sourceTitle}\nClick to use as the prompt below — edit, then Send.`}
          >
            <span className="font-medium text-text-secondary">{nextStep.label}</span>{" "}
            {nextStep.text}
          </button>
        )}
      </div>

      {profileOpen ? (
        <ProjectProfile
          project={project}
          globalAdapter={currentAdapter}
          localAgent={localAgent}
          availableAgents={availableAgents}
          onSetAgent={setLocalAgent}
          onFillPrompt={setCustom}
          onRunPrompt={(prompt, agent) => onRunCustomPrompt(project, prompt, agent)}
        />
      ) : (
        <>
          <ProjectBanners
            tab={project.tab}
            isClosed={display.isClosed}
            isClosing={display.isClosing}
            isReady={display.isReady}
            isOrchReady={display.isOrchestrationReady}
            showRunning={display.showRunningBanner}
            session={project.session}
            closingAt={project.closingAt}
            currentPrompt={project.currentPrompt}
            prompts={prompts}
            autoContinueEnabled={automaticContinuationEnabled}
            paused={paused}
            nextQueueItem={sessionHealthBlocksQueue() ? undefined : queue[0]}
            queueTotal={sessionHealthBlocksQueue() ? 0 : queue.length}
            healthBypass={
              sessionHealthBlocksQueue() && queue.length > 0
                ? project.session?.health?.toLowerCase().includes("critical")
                  ? "Health critical"
                  : "Tests failing"
                : undefined
            }
            dispatchReason={undefined}
            onDismiss={() => setDismissed(true)}
            onSend={send}
            onAutoInject={runtimeAvailable !== false ? handleAutoInject : undefined}
            onToggleAutoContinue={automationMode === "off" ? undefined : toggleAutoContinue}
            showKeyHints={isOnlyReady}
            inactiveLabel={undefined}
            countdownSeconds={countdownSeconds}
          />
          {(display.isReady || display.isOrchestrationReady) && (
            <SessionSummary session={project.session} isClosed={display.isClosed} />
          )}
          {display.tone === "idle" && project.session && !display.tabOpen && (
            <div className="border-t border-border-subtle">
              <p className="px-4 pt-4 text-xs font-medium text-text-muted sm:px-5 md:px-6">
                Saved context from the last agent run
              </p>
              <SessionSummary session={project.session} isClosed={false} />
            </div>
          )}
          {showPreviousRunPanel && latestOrchRun && (
            <LatestOrchestrationPanel run={latestOrchRun} nowMs={nowS * 1000} />
          )}

          {/* Idle with no agent running — offer to launch one, whether or not a
              terminal tab is already open. Previously the launch button was
              gated on !display.tabOpen, so a "tab open, no agent" project (the
              common case after an agent exits) got a dead-end text message and
              NO way to start an agent — and any prompt sent landed in the bare
              shell. The launch path (/api/agent/launch) is the same regardless
              of tab state. */}
          {display.tone === "idle" && !display.isRunning && runtimeStateKnown && onLaunch && (
            <div className="ui-card-section flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-text-secondary">
                {display.tabOpen
                  ? runnerSyncStale
                    ? "Terminal tab is open, but live status is stale — launch an agent or relaunch Fleet Runner."
                    : "Terminal tab is open, but no agent is running in it. Launch one to start work."
                  : "No agent is currently running for this project."}
              </p>
              <button onClick={onLaunch} className="ui-btn-primary shrink-0 gap-1.5">
                <Play className="h-3.5 w-3.5" />
                Launch agent
              </button>
            </div>
          )}

          <IntentButtonPanel
            project={project}
            currentAdapter={currentAdapter}
            runtimeAvailable={runtimeAvailable}
            runtimeStateKnown={runtimeStateKnown}
            runnerSyncStale={runnerSyncStale}
            isRunning={display.isRunning}
            autoContinueEnabled={automationMode === "off" ? false : autoContinueEnabled}
            sending={sending}
            justSent={justSent}
            sendError={sendError}
            onClearSendError={clearSendError}
            custom={custom}
            queue={queue}
            bannerActive={display.isClosed || display.isReady || display.isOrchestrationReady}
            merging={merging}
            onToggleAutoContinue={automationMode === "off" ? undefined : toggleAutoContinue}
            onSendIntent={sendIntent}
            onSendCustom={sendCustom}
            onEnqueueCustom={smartEnqueue}
            onSendText={sendText}
            onSendFromQueue={handleSendFromQueue}
            onRemoveFromQueue={removeFromQueue}
            onReorderInQueue={reorderInQueue}
            onEditInQueue={editInQueue}
            onMergeQueue={handleMergeQueue}
            onMergeItemsInQueue={mergeItemsInQueue}
            onCustomChange={setCustom}
            onCustomFocusChange={setCustomFocused}
            automationStatusLabel={automationStatusLabel}
            queueBlockedReason={queueBlockedReason}
          />
          <ProjectActivitySection
            activity={project.recentActivity}
            git={project.git}
            projectTab={project.tab}
            onReusePrompt={setCustom}
          />
        </>
      )}
    </div>
  );
}
