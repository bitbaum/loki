/**
 * Client-safe agent resolution helpers — no Node/fs imports.
 *
 * Used by project cards, command palette, and control-presenter to agree on
 * which agent is running, whether the UI label is stale, and what to switch to
 * on capacity issues. Server routes that need /proc scans use
 * resolveRunningAgentsInDir() in agent-process-scan.ts instead.
 */

import { ALL_AGENT_IDS, AGENT_LABELS, type AnyAgentId } from "@/lib/agent-labels";
import type { ProjectState } from "@/lib/control-types";

export const AGENT_FALLBACK_ORDER = ["claude", "cursor", "codex", "gemini", "grok"] as const;

const CAPACITY_ISSUE_RE =
  /rate\s*limit|quota|credit|usage\s*limit|token\s*limit|weekly\s*limit|limit\s+left:\s*0%|hit your .{0,20}limit|out\s+of\s+tokens|context\s*(window|length|limit)|maximum\s+context|insufficient\s+quota/i;

/** Tab suffix → adapter id: "Loki Cursor" → "cursor". */
export function inferAdapterFromTabName(tabName: string): AnyAgentId | null {
  const normalized = tabName.toLowerCase();
  for (const id of ALL_AGENT_IDS) {
    if (normalized === id || normalized.endsWith(` ${id}`) || normalized.endsWith(`-${id}`)) {
      return id;
    }
  }
  return null;
}

export function looksLikeAgentCapacityIssue(text: string): boolean {
  return CAPACITY_ISSUE_RE.test(text);
}

/** Ordered list of agent IDs we believe are active for this project. */
export function resolveDetectedAgentIds(project: ProjectState, liveTab?: string): string[] {
  const tab = liveTab ?? project.liveTab ?? project.tab;
  const fromProc = project.activeAgents.filter(Boolean);
  if (fromProc.length) return [...new Set(fromProc)];

  const fromPrompt = project.currentPrompt?.adapter?.trim();
  if (fromPrompt) return [fromPrompt];

  const fromTab = inferAdapterFromTabName(tab);
  if (fromTab) return [fromTab];

  if (project.agentPref) return [project.agentPref];
  return [];
}

/** Best guess for the agent to quit when switching — prefers live detection. */
export function resolveOutgoingAgent(
  project: ProjectState,
  localAgent?: string | null,
): string | null {
  const detected = resolveDetectedAgentIds(project);
  if (detected.length === 1) return detected[0]!;
  if (detected.length > 1) return detected[0]!;
  return localAgent ?? project.agentPref ?? null;
}

/** Agent ID the status chip should highlight as "active". */
export function resolveDisplayedAgentId(
  project: ProjectState,
  localAgent?: string | null,
  liveTab?: string,
): string {
  const detected = resolveDetectedAgentIds(project, liveTab);
  if (detected.length) return detected[0]!;
  return localAgent ?? project.agentPref ?? "";
}

/** True when preference/label disagrees with live process scan. */
export function hasAgentLabelMismatch(
  project: ProjectState,
  localAgent?: string | null,
  liveTab?: string,
): boolean {
  if (!project.agentRunning) return false;
  const live = resolveDetectedAgentIds(project, liveTab)[0];
  if (!live) return false;
  const preferred = localAgent ?? project.agentPref;
  if (!preferred) return false;
  return preferred !== live;
}

export function agentLabel(agentId: string): string {
  return AGENT_LABELS[agentId as AnyAgentId] ?? agentId[0]?.toUpperCase() + agentId.slice(1);
}

/** Scan session fields for rate-limit / quota language. */
export function detectCapacityIssueFromProject(project: ProjectState): boolean {
  const parts = [
    project.session?.status,
    project.session?.done,
    project.session?.next,
    project.session?.health,
    project.currentPrompt?.label,
  ].filter(Boolean) as string[];
  return parts.some(looksLikeAgentCapacityIssue);
}

/**
 * Next switchable agent in fallback order (client-side; pass installed ids).
 *
 * `order` is the OPERATOR's ranking (user_preferences.agent_order), and passing
 * it is not optional politeness. b71941be shipped a settings surface where the
 * operator ranks their providers, and every caller that kept resolving against
 * the fleet default silently overruled it: the Feedback row offered "Try Grok"
 * while Control's capacity banner offered "Switch to Cursor" for the same
 * stalled project, and the headless reroute picked Cursor with nobody watching.
 * Two surfaces disagreeing about one run is a defect by this product's own
 * contract (docs/foundation/LOKI-WORKS.md).
 *
 * Defaults to AGENT_FALLBACK_ORDER so a caller with no user context (and no way
 * to know the preference) behaves exactly as before rather than guessing.
 */
export function resolveNextFallbackAgent(
  currentAgent: string | null | undefined,
  availableIds: readonly string[],
  order: readonly string[] = AGENT_FALLBACK_ORDER,
): string | null {
  const available = new Set(availableIds);
  const current = currentAgent && available.has(currentAgent) ? currentAgent : null;
  // An order that ranks only some agents must still be able to reach the rest,
  // or a half-filled preference would shrink the fallback set to nothing.
  const ranked = [...order, ...AGENT_FALLBACK_ORDER.filter((id) => !order.includes(id))];

  if (current) {
    const idx = ranked.indexOf(current);
    const after = idx >= 0 ? ranked.slice(idx + 1) : ranked;
    for (const candidate of after) {
      if (available.has(candidate) && candidate !== current) return candidate;
    }
  }

  for (const candidate of ranked) {
    if (candidate !== current && available.has(candidate)) return candidate;
  }
  return null;
}
