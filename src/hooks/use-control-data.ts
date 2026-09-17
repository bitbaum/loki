"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ControlData, ProjectState } from "@/lib/control-types";
import type { FastProjectState } from "@/lib/control-fast-state";
import type { OrchestrationTaskIntentId } from "@/lib/orchestration";
import { getJson } from "@/lib/api/fetch";
import type { Agent } from "@/lib/agent-registry";
import type { Attachment } from "@/lib/loki/attachments";
import { LOKI_REFRESH_EVENT } from "@/lib/client-events";
import { useEventStream } from "@/lib/event-stream";
import { applyProjectPatches } from "@/lib/control-project-patch";
import { buildControlActions, type InjectResult, type TabResult } from "./use-control-actions";
import { useControlProjectStream } from "./use-control-project-stream";
type AgentEntry = ControlData["agentRegistry"]["agents"][number];
export interface ControlDataHook {
  data: ControlData | null;
  lastUpdated: number | null;
  refreshing: boolean;
  error: string | null;
  selectedAgent: Agent;
  model: string;
  savedConfig: ControlData["agentConfig"] | null;
  switchableRegistry: AgentEntry[];
  activeDefinition: AgentEntry | null;
  selectedDefinition: AgentEntry | null;
  hasPendingChange: boolean;
  savingAgent: boolean;
  lastTabResults: TabResult[];
  lastTabResultsAt: number | null;
  runtimeAvailable: boolean;
  runnerLastPushedAt: string | null;
  runnerVersion: string | null;
  builderPresence: { cloud: boolean; local: boolean; any: boolean } | null;
  /** Connection-based presence (bridge SSE). null = no event yet → fall back
   *  to heartbeat age. true/false = authoritative live signal. */
  runnerConnected: boolean | null;
  refresh: (manual?: boolean) => Promise<void>;
  inject: (
    tab: string,
    promptKey?: string,
    customPrompt?: string,
    attachments?: Attachment[],
  ) => Promise<InjectResult>;
  launchProject: (
    tab: string,
    dir: string,
    agent?: string,
    model?: string,
    initialPrompt?: string,
  ) => Promise<void>;
  runWithBrain: (project: ProjectState, intent: OrchestrationTaskIntentId) => Promise<void>;
  runCustomPrompt: (project: ProjectState, prompt: string, ag: string) => Promise<void>;
  saveAgent: (applyToOpenTabs: boolean) => Promise<void>;
  handleAgentSelect: (agentId: string, defaultModel: string | undefined) => void;
  handleModelChange: (value: string) => void;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useControlData(): ControlDataHook {
  const [data, setData] = useState<ControlData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<Agent | "">("");
  const [draftModels, setDraftModels] = useState<Partial<Record<Agent, string>>>({});
  const [savingAgent, setSavingAgent] = useState(false);
  const [agentDirty, setAgentDirty] = useState(false);
  const [lastTabResults, setLastTabResults] = useState<TabResult[]>([]);
  const [lastTabResultsAt, setLastTabResultsAt] = useState<number | null>(null);
  // Connection-based presence: live "is the runner connected to the bridge"
  // signal pushed on every /control/stream event. null until first event (so
  // the heartbeat-age fallback still governs the badge pre-rollout).
  // See docs/architecture/connection-presence.md.
  const [runnerConnected, setRunnerConnected] = useState<boolean | null>(null);
  const [builderPresence, setBuilderPresence] = useState<{
    cloud: boolean;
    local: boolean;
    any: boolean;
  } | null>(null);
  const inFlight = useRef(false);

  const registry = data?.agentRegistry.agents ?? [];
  const switchableRegistry = registry.filter((entry) => entry.switchable);
  const defaultAgent = data?.agentRegistry.defaultAgent ?? switchableRegistry[0]?.id ?? "claude";
  const selectedAgent = (agent || data?.agentConfig.agent || defaultAgent) as Agent;
  const selectedDefinition = switchableRegistry.find((entry) => entry.id === selectedAgent) ?? null;
  const activeDefinition =
    switchableRegistry.find((entry) => entry.id === data?.agentConfig.agent) ?? null;
  const model =
    draftModels[selectedAgent] ?? data?.agentConfig.model ?? selectedDefinition?.defaultModel ?? "";
  const savedConfig = data?.agentConfig ?? null;
  const hasAgentChange = savedConfig ? selectedAgent !== savedConfig.agent : false;
  const hasModelChange = savedConfig ? model.trim() !== savedConfig.model : false;
  const hasPendingChange = hasAgentChange || hasModelChange;

  // Core fetch: every setState lives in a promise callback, so the mount
  // effect can start it without setting state synchronously in the effect body.
  const fetchControl = useCallback(
    () =>
      getJson<ControlData>("/api/control")
        .then((payload) => {
          setData(payload);
          if (payload.builderPresence) setBuilderPresence(payload.builderPresence);
          if (payload.builderPresence?.any) setRunnerConnected(true);
          else if (payload.builderPresence && !payload.builderPresence.any)
            setRunnerConnected(false);
          if (!agentDirty) {
            setAgent(payload.agentConfig.agent);
            setDraftModels({ [payload.agentConfig.agent]: payload.agentConfig.model });
          }
          setLastUpdated(Date.now());
          setError(null);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Failed to load");
        }),
    [agentDirty],
  );

  // Event-context wrapper: manual refreshes prime the spinner.
  const refresh = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      try {
        await fetchControl();
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [fetchControl],
  );

  useEffect(() => {
    const poll = async () => {
      if (document.hidden || inFlight.current) return;
      inFlight.current = true;
      await fetchControl();
      inFlight.current = false;
    };

    // Always fetch on mount — bypass visibility so background-opened tabs load data.
    inFlight.current = true;
    fetchControl().finally(() => {
      inFlight.current = false;
    });

    // Three triggers for refetch after mount, all event-driven — no setInterval:
    //   1. visibilitychange: tab comes back to foreground (covers backgrounded
    //      tabs whose SSE was throttled by the browser).
    //   2. LOKI_REFRESH_EVENT: pull-to-refresh, manual refresh button,
    //      and other surfaces that broadcast "the world might have changed."
    //   3. The bridge SSE useEventStream subscription below — fires on every
    //      Postgres NOTIFY for this user.
    // Plus the dedicated /api/control/stream EventSource further down, which
    // pushes projects-update patches directly into setData without a full
    // /api/control refetch. With both push paths active, polling on a timer
    // is paying for an outage that hasn't happened — delete it.
    const onVisibilityChange = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const onLokiRefresh = () => {
      poll();
    };
    window.addEventListener(LOKI_REFRESH_EVENT, onLokiRefresh);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(LOKI_REFRESH_EVENT, onLokiRefresh);
    };
  }, [fetchControl]);

  // Subscribe to the SSE bridge for live change events. Any event for the
  // user (project_states, runtime_snapshots, pending_commands, etc.)
  // triggers a coalesced refetch of /api/control. The bridge tells us
  // *something* changed; the cloud snapshot tells us *what* it now is.
  //
  // This is push-driven freshness without replacing the snapshot route's
  // role — the snapshot still owns the merged view. With the setInterval
  // baseline removed above, this and the /api/control/stream EventSource
  // below are the only refresh triggers between mount and tab visibility
  // changes.
  const eventCoalesce = useRef<NodeJS.Timeout | null>(null);
  const eventState = useEventStream({
    onChange: () => {
      // Coalesce bursts of events (a Run state machine often touches
      // 3-4 rows in succession) into a single refetch. 200ms is short
      // enough to feel instant and long enough to absorb a burst.
      if (eventCoalesce.current) clearTimeout(eventCoalesce.current);
      eventCoalesce.current = setTimeout(() => {
        eventCoalesce.current = null;
        if (!document.hidden && !inFlight.current) {
          inFlight.current = true;
          refresh().finally(() => {
            inFlight.current = false;
          });
        }
      }, 200);
    },
  });
  // Expose the live-mode indicator to consumers via a window-level event
  // for any small "live updates: on" badge that wants to render. Cheaper
  // than threading state through the existing hook's return shape, which
  // is already wide. Tabs that don't care about the mode just ignore it.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("loki:event-stream-mode", { detail: eventState }));
    }
  }, [eventState]);

  const mergeProjectPatches = useCallback((patches: FastProjectState[]) => {
    setData((prev) => (prev ? applyProjectPatches(prev, patches) : prev));
    setLastUpdated(Date.now());
  }, []);

  useControlProjectStream({
    onPatches: mergeProjectPatches,
    onPresence: setBuilderPresence,
    onRunnerConnected: setRunnerConnected,
  });

  useEffect(() => {
    if (!lastTabResultsAt) return;
    const id = setTimeout(() => {
      setLastTabResults([]);
      setLastTabResultsAt(null);
    }, 30_000);
    return () => clearTimeout(id);
  }, [lastTabResultsAt]);

  const { inject, launchProject, runWithBrain, runCustomPrompt, saveAgent } = buildControlActions({
    data,
    selectedAgent,
    model,
    setError,
    setSavingAgent,
    setAgentDirty,
    setLastTabResults,
    setLastTabResultsAt,
    setDraftModels,
    refresh,
  });

  const handleAgentSelect = (agentId: string, defaultModel: string | undefined) => {
    const next = agentId as Agent;
    setAgentDirty(true);
    setAgent(next);
    setDraftModels((current) => ({
      ...current,
      [next]: current[next] ?? defaultModel ?? "",
    }));
  };

  const handleModelChange = (value: string) => {
    setAgentDirty(true);
    setDraftModels((current) => ({ ...current, [selectedAgent]: value }));
  };

  return {
    data,
    lastUpdated,
    refreshing,
    error,
    selectedAgent,
    model,
    savedConfig,
    switchableRegistry,
    activeDefinition,
    selectedDefinition,
    hasPendingChange,
    savingAgent,
    lastTabResults,
    lastTabResultsAt,
    runtimeAvailable: data?.runtimeAvailable ?? true,
    runnerLastPushedAt: data?.runnerLastPushedAt ?? null,
    runnerVersion: data?.runnerVersion ?? null,
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
    setError,
  };
}
