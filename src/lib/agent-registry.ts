/**
 * Compatibility shim over the adapter registry in src/lib/agents/.
 *
 * Pre-2026-06-07 this file was 427 lines of mixed data + behavior — agent
 * IDs, hardcoded availability checks per agent, a `buildAgentOptionLaunchCommand`
 * switch statement, and a `syncAgentSettings` function that only worked
 * for Claude. Adding a new agent meant editing this file in 5+ places.
 *
 * Post-refactor (Port 1 from the architecture plan): each agent owns its
 * own module under `src/lib/agents/<id>.ts` implementing `AgentAdapter`.
 * This file is now a thin shim that re-exports the historical names so
 * existing call sites (api/control, agent-catalog, control-presenter, etc.)
 * keep working unchanged. Net code reduction: ~300 lines.
 *
 * Migration roadmap: callers should be moved off these compat exports onto
 * direct `import { findAdapter, ALL_ADAPTERS } from "@/lib/agents"` over
 * time. This shim stays for back-compat until that's complete; new code
 * should import from `@/lib/agents` directly.
 */

import {
  ALL_ADAPTERS,
  findAdapter,
  effectiveDefaultModel,
  effectiveModelSuggestions,
} from "@/lib/agents";
import type { AgentAdapter } from "@/lib/agents";
import {
  AGENT_FALLBACK_ORDER,
  looksLikeAgentCapacityIssue as detectCapacityIssue,
} from "@/lib/agent-resolution";

export const AGENT_IDS = ["codex", "claude", "gemini", "cursor", "grok"] as const;
export type Agent = (typeof AGENT_IDS)[number];

/**
 * Re-export, not a second definition. This file used to declare its own
 * `AGENT_FALLBACK_ORDER` beside the one in agent-resolution.ts — the same five
 * ids, written twice, with nothing keeping them in step. The server reroute
 * (resolveNextAvailableAgent, here) and the client reroute
 * (resolveNextFallbackAgent, there) each read their own copy, so adding an
 * agent to one would have silently split the fleet's fallback policy in half.
 * agent-resolution.ts owns it because it is the client-safe leaf.
 */
export { AGENT_FALLBACK_ORDER } from "@/lib/agent-resolution";
export type AgentOption = Agent | "openclaw";

export { ALL_AGENT_IDS, AGENT_LABELS, type AnyAgentId } from "./agent-labels";

/** Pre-refactor public default-model map, derived from the adapter SSOT
 *  (each adapter's `defaultModel`). Still used in a handful of
 *  config-resolution paths; long-term those callers should read from the
 *  adapter directly. */
export const AGENT_DEFAULT_MODELS: Record<Agent, string> = Object.fromEntries(
  AGENT_IDS.map((id) => [id, findAdapter(id)!.defaultModel]),
) as Record<Agent, string>;

export type AgentRegistryEntry = {
  id: AgentOption;
  label: string;
  defaultModel: string;
  modelSuggestions: string[];
  processMatchers: string[];
  switchable: boolean;
  available: boolean;
  availabilityReason?: string;
  quitCommand: string;
  installCommand?: string;
  sessionDir?: string;
  directActivitySource?: "hooks" | "native-session-log";
  capabilities: {
    tabSwitching: boolean;
    manualPromptInjection: boolean;
    autonomousPromptLoop: boolean;
    sessionLifecycleSignals: boolean;
  };
};

/** Materialize an adapter into the historical `AgentRegistryEntry` shape —
 *  factoring in user-configured models + live availability detection. */
function entryFromAdapter(adapter: AgentAdapter): AgentRegistryEntry {
  const availability = adapter.detectAvailable();
  return {
    id: adapter.id as AgentOption,
    label: adapter.label,
    defaultModel: effectiveDefaultModel(adapter),
    modelSuggestions: [...effectiveModelSuggestions(adapter)],
    processMatchers: [...adapter.processMatchers],
    switchable: adapter.switchable,
    available: availability.available,
    availabilityReason: availability.availabilityReason,
    quitCommand: adapter.quitCommand,
    installCommand: adapter.installCommand,
    sessionDir: adapter.sessionDir,
    directActivitySource: adapter.directActivitySource,
    capabilities: { ...adapter.capabilities },
  };
}

export function listAgentRegistry(): AgentRegistryEntry[] {
  return ALL_ADAPTERS.map(entryFromAdapter);
}

export function sanitizeAgentId(value: string | undefined): Agent {
  if (value === "claude") return "claude";
  if (value === "gemini") return "gemini";
  if (value === "cursor") return "cursor";
  if (value === "grok") return "grok";
  return "codex";
}

export function isAgentId(value: string | undefined | null): value is Agent {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "gemini" ||
    value === "cursor" ||
    value === "grok"
  );
}

export function looksLikeAgentCapacityIssue(text: string): boolean {
  return detectCapacityIssue(text);
}

/** Find the next agent in `AGENT_FALLBACK_ORDER` that's installed + switchable.
 *  Used by the rate-limit / quota fallback path: if Claude exhausted its
 *  budget, try Cursor, then Codex, etc. */
export function resolveNextAvailableAgent(currentAgent?: string | null): Agent | null {
  const current = isAgentId(currentAgent) ? currentAgent : null;
  const registry = listAgentRegistry();
  const available = new Set(
    registry
      .filter(
        (entry) =>
          entry.switchable &&
          entry.available &&
          entry.capabilities.tabSwitching &&
          isAgentId(entry.id),
      )
      .map((entry) => entry.id as Agent),
  );

  if (current) {
    const currentIndex = AGENT_FALLBACK_ORDER.indexOf(current);
    const afterCurrent = AGENT_FALLBACK_ORDER.slice(currentIndex + 1);
    for (const candidate of afterCurrent) {
      if (available.has(candidate)) return candidate;
    }
  }

  for (const candidate of AGENT_FALLBACK_ORDER) {
    if (candidate !== current && available.has(candidate)) return candidate;
  }

  return null;
}

/** Persist the user-selected model to the agent's own config file. Today
 *  only Claude writes (~/.claude/settings.json). Other adapters return
 *  early when their `syncSelectedModel` is undefined. */
export function syncAgentSettings(agent: Agent, model: string): void {
  const adapter = findAdapter(agent);
  if (adapter?.syncSelectedModel) {
    adapter.syncSelectedModel(model);
  }
}

/** Returns the official install command for the given agent (or empty if unknown). */
export function getAgentInstallCommand(agent: AgentOption): string {
  return findAdapter(agent)?.installCommand ?? "";
}

/** AgentOption-typed variant — accepts both Agent and "openclaw". */
export function buildAgentOptionLaunchCommand(
  config: { agent: AgentOption; model?: string; sessionId?: string },
  dir: string,
): string {
  const adapter = findAdapter(config.agent);
  if (!adapter) {
    // Defensive default — fall back to codex if somehow an unknown id reaches us.
    // Pre-refactor the switch's default branch did exactly this.
    return findAdapter("codex")!.buildLaunchCommand({ dir, model: config.model });
  }
  return adapter.buildLaunchCommand({ dir, model: config.model, sessionId: config.sessionId });
}
