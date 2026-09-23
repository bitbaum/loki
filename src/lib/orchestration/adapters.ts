import { createCapabilities, type AdapterCapabilities, type AdapterId } from "./contract";

export type AdapterDefinition = {
  id: AdapterId;
  label: string;
  capabilities: AdapterCapabilities;
  notes: string;
};

export const ADAPTER_DEFINITIONS: Record<AdapterId, AdapterDefinition> = {
  claude: {
    id: "claude",
    label: "Claude",
    capabilities: createCapabilities({
      launchSession: true,
      injectTask: true,
      detectRunning: true,
      detectWaiting: true,
      detectDone: true,
      closeSession: true,
      autonomousContinue: true,
      sessionHandoff: true,
      cloudQueueable: true,
      tabInjected: true,
    }),
    notes: "Current production-grade adapter with local hook-driven lifecycle support.",
  },
  codex: {
    id: "codex",
    label: "Codex",
    capabilities: createCapabilities({
      launchSession: true,
      injectTask: true,
      detectRunning: true,
      sessionHandoff: true,
      tabInjected: true,
    }),
    notes: "Partially integrated backend; needs lifecycle and close-session support.",
  },
  openclaw: {
    id: "openclaw",
    label: "OpenClaw",
    capabilities: createCapabilities({
      injectTask: true,
      detectRunning: true,
      detectDone: true,
      autonomousContinue: true,
      sessionHandoff: true,
    }),
    notes:
      "Target orchestrator of record; should own durable task execution rather than imitate local Claude hooks.",
  },
  gemini: {
    id: "gemini",
    label: "Antigravity",
    capabilities: createCapabilities({
      launchSession: true,
      injectTask: true,
      detectRunning: true,
      sessionHandoff: true,
      tabInjected: true,
    }),
    notes: "Local Antigravity CLI integration (legacy internal ID: gemini).",
  },
  grok: {
    id: "grok",
    label: "Grok",
    capabilities: createCapabilities({
      launchSession: true,
      injectTask: true,
      detectRunning: true,
      detectWaiting: true,
      detectDone: true,
      closeSession: true,
      autonomousContinue: true,
      sessionHandoff: true,
      tabInjected: true,
    }),
    notes:
      "Local Grok CLI integration with adapter-aware handoffs and hook-driven lifecycle state.",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    capabilities: createCapabilities({
      launchSession: true,
      injectTask: true,
      detectRunning: true,
      sessionHandoff: true,
      tabInjected: true,
      cloudQueueable: true,
    }),
    notes:
      "Cursor Agent CLI (cursor-agent) on This computer or cloud builder — must be on PATH and logged in.",
  },
};

export function getAdapterDefinition(adapterId: AdapterId): AdapterDefinition {
  return ADAPTER_DEFINITIONS[adapterId];
}
