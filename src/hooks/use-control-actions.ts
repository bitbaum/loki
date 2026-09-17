"use client";

import type { ControlData, ProjectState } from "@/lib/control-types";
import type { OrchestrationTaskIntentId } from "@/lib/orchestration";
import { postJson, throwApiError } from "@/lib/api/fetch";
import {
  REFRESH_AFTER_DISPATCH_MS,
  REFRESH_AFTER_LAUNCH_MS,
  AGENT_COLD_START_MS,
} from "@/lib/constants/timings";
import type { Agent } from "@/lib/agent-registry";
import type { Attachment } from "@/lib/loki/attachments";
import { EXECUTOR_COPY } from "@/config/executor-copy";

export type TabResult = { status: string; tab?: string; reason?: string; error?: string };

export type InjectResult = {
  mode: "direct" | "queued";
  runnerConnected: boolean | null;
  commandId: string | null;
};

/**
 * Everything /control can DO, as opposed to everything it knows.
 *
 * These are plain async functions over fetch — no state of their own. They take
 * the snapshot and the two callbacks (`setError`, `refresh`) the panel owns, so
 * the data hook stays about data.
 */
export function buildControlActions(deps: {
  data: ControlData | null;
  selectedAgent: Agent;
  model: string;
  setError: (message: string | null) => void;
  setSavingAgent: (saving: boolean) => void;
  setAgentDirty: (dirty: boolean) => void;
  setLastTabResults: (results: TabResult[]) => void;
  setLastTabResultsAt: (at: number | null) => void;
  setDraftModels: (
    updater: (current: Partial<Record<Agent, string>>) => Partial<Record<Agent, string>>,
  ) => void;
  refresh: (manual?: boolean) => Promise<void>;
}) {
  const { data, selectedAgent, model, setError, refresh } = deps;

  const inject = async (
    tab: string,
    promptKey?: string,
    customPrompt?: string,
    attachments?: Attachment[],
  ): Promise<InjectResult> => {
    // Same-machine fast path (POST localhost:3001/api/inject → home/server.ts
    // → bash inject_prompt) was retired in Session 4 of killing-the-bash-
    // runner (2026-06-11). Every inject now goes through the cloud
    // /api/inject endpoint; Fleet Runner desktop polls /api/control/commands
    // and types the resulting prompt into zellij. Same end-state, one
    // transport instead of two, no bash anywhere.
    const res = await postJson("/api/inject", {
      tab,
      promptKey,
      customPrompt,
      adapter: data?.agentConfig.agent ?? selectedAgent,
      // Screenshots ride along raw; the server turns them into text (it must
      // not be skippable from here — see lib/composer-attachments).
      ...(attachments?.length ? { attachments } : {}),
    });
    if (!res.ok) await throwApiError(res, `HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    // Don't let an offline runner read as success — say it out loud.
    if (body.warning === "runner-offline") {
      setError(body.message ?? EXECUTOR_COPY.queuedWhenOfflineLong);
    }
    setTimeout(refresh, REFRESH_AFTER_DISPATCH_MS);
    return {
      mode: body.mode === "queued" ? "queued" : "direct",
      runnerConnected: typeof body.runnerConnected === "boolean" ? body.runnerConnected : null,
      // The queued path returns the pending_command id so the card can poll its
      // real lifecycle (queued → picked up → ran/failed) instead of the ambient
      // dir-scoped guess. Direct mode ran in-process — no command row to track.
      commandId: typeof body.commandId === "string" ? body.commandId : null,
    };
  };

  const launchProject = async (
    tab: string,
    dir: string,
    agent?: string,
    model?: string,
    initialPrompt?: string,
  ) => {
    const res = await postJson("/api/agent/launch", {
      tab,
      dir,
      agent: agent ?? selectedAgent,
      model,
      initialPrompt: initialPrompt?.trim() || undefined,
    });
    if (!res.ok) await throwApiError(res, `HTTP ${res.status}`);
    setTimeout(() => refresh(true), REFRESH_AFTER_LAUNCH_MS);
  };

  const runWithBrain = async (project: ProjectState, intent: OrchestrationTaskIntentId) => {
    setError(null);
    let queue: string[] = [];
    try {
      const queueRes = await fetch(`/api/beacon/queue/${encodeURIComponent(project.tab)}`);
      if (queueRes.ok) {
        const stored = (await queueRes.json()) as { queue?: unknown };
        if (Array.isArray(stored.queue))
          queue = stored.queue.filter((item): item is string => typeof item === "string");
      }
    } catch {
      /* queue context remains best-effort */
    }
    const res = await postJson("/api/orchestration/run", {
      projectId: project.projectId,
      projectKey: project.tab,
      projectPath: project.dir,
      adapter: data?.agentConfig.agent ?? "claude",
      intent,
      queue,
    });
    if (!res.ok) await throwApiError(res, `HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (body.warning === "runner-offline") {
      setError(
        body.message ?? "Fleet Runner is offline — queued; it will run when the runner reconnects.",
      );
    }
    await refresh(true);
  };

  const runCustomPrompt = async (project: ProjectState, prompt: string, ag: string) => {
    if (!project.agentRunning) {
      await postJson("/api/agent/launch", { tab: project.tab, dir: project.dir, agent: ag });
      await new Promise((r) => setTimeout(r, AGENT_COLD_START_MS));
    }
    const res = await postJson("/api/orchestration/run", {
      projectId: project.projectId,
      projectKey: project.tab,
      projectPath: project.dir,
      adapter: ag,
      intent: "custom",
      customInstructions: prompt,
    });
    if (!res.ok) await throwApiError(res, `HTTP ${res.status}`);
    await refresh(true);
  };

  const saveAgent = async (applyToOpenTabs: boolean) => {
    deps.setSavingAgent(true);
    try {
      const res = await postJson("/api/control/agent", {
        agent: selectedAgent,
        model,
        applyToOpenTabs,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      deps.setAgentDirty(false);
      deps.setLastTabResults(Array.isArray(body.tabResults) ? body.tabResults : []);
      deps.setLastTabResultsAt(Array.isArray(body.tabResults) ? Date.now() : null);
      deps.setDraftModels((current) => ({ ...current, [selectedAgent]: model }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update brain");
    } finally {
      deps.setSavingAgent(false);
    }
  };

  return { inject, launchProject, runWithBrain, runCustomPrompt, saveAgent };
}
