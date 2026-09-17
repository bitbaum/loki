/**
 * "Try a provider that still has quota" — the whole decision, as pure functions.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 *
 * When the agent building a project hits a rate limit, the operator already
 * owns a way out: four other agent CLIs, most of them with untouched quota. The
 * cost of taking it was the problem. The only chooser lived in the Terminal
 * right rail, it offered every agent in a fixed order whether or not the
 * connected builder had it installed, and taking it swapped the live PTY
 * without recording the choice — so the next dispatch went straight back to the
 * agent that had just run out.
 *
 * So: one ranking, three inputs, used by every surface that can show a blocked
 * run (Feedback row, Control inbox, Terminal rail).
 *
 * ── WHAT COUNTS AS "CAN ACTUALLY ANSWER" ────────────────────────────────────
 *
 * Two pieces of evidence, both observed rather than polled:
 *
 *   1. INSTALLED — the connected builder's capability report
 *      (`runtime_snapshots.installed_agents`). An agent the builder never
 *      reported cannot be launched there, so offering it is offering a button
 *      that quits a working CLI to start a binary that is not present.
 *
 *   2. SPENT — a recent run on that agent that died with capacity language
 *      (`orchestration_runs.adapter` + payload error, read through
 *      `looksLikeAgentCapacityIssue`). This is the agent-CLI equivalent of the
 *      rate-limit headers `provider_quota` records: evidence from a call we
 *      were making anyway, never a probe that spends quota to measure quota.
 *
 * `provider_quota` itself is deliberately NOT an input. That table meters the
 * ai-kit INFERENCE chain (groq, openrouter) that answers Loki's own chat and
 * form-assist calls. Claude Code and Codex are not links in that chain, and
 * wiring a groq counter into a Claude Code chooser would have been a number
 * that looks like evidence and is about a different system.
 *
 * ── ABSENT IS NOT EMPTY ─────────────────────────────────────────────────────
 *
 * The same three-state rule `provider_quota` is built on: an agent the builder
 * said nothing about is UNKNOWN, and unknown reads as usable. A control plane
 * with no runner connected knows nothing about anything, and drawing that as
 * "every provider is unavailable" would disable the one control the operator
 * came for. Only an explicit report excludes an agent — exactly the rule
 * `AgentSwitcherPopover` already holds for its disabled rows.
 */
import {
  QUOTA_ALTERNATIVE_AGENTS,
  isQuotaAlternativeId,
  providerLabel,
  type QuotaAlternativeId,
} from "@/config/quota-alternatives";
import { AGENT_FALLBACK_ORDER, looksLikeAgentCapacityIssue } from "@/lib/agent-resolution";

/** How long a capacity wall keeps a provider out of the chooser. */
export const PROVIDER_SPENT_WINDOW_MS = 60 * 60 * 1000;

/**
 * WHY a provider cannot answer — typed, not just prose.
 *
 * The chooser prints a short suffix beside a disabled row, and "not installed"
 * was hardcoded there. A provider that is installed and merely out of quota
 * would then have read "(not installed)" beside a sentence saying it hit a
 * limit — two different claims about the same agent, one of them false.
 */
export type ProviderBlock = "not-installed" | "spent";

export const PROVIDER_BLOCK_NOTE: Record<ProviderBlock, string> = {
  "not-installed": "not installed",
  spent: "out of quota",
};

export type ProviderOption = {
  id: QuotaAlternativeId;
  label: string;
  /** Offer it as a one-tap switch. False rows still render, disabled, with why. */
  usable: boolean;
  /** Why this one cannot answer. Null when it can. */
  reason: string | null;
  /** Which kind of "cannot". Null when usable. */
  block: ProviderBlock | null;
};

/**
 * The operator's order, repaired.
 *
 * Saved order wins, unknown ids are dropped, and every agent the operator did
 * not rank is appended in default order rather than disappearing — a provider
 * missing from the chooser because it was missing from a preference list is
 * the same invisible dead end this whole feature exists to remove.
 */
export function preferredProviderOrder(
  saved: readonly string[] | null | undefined,
): QuotaAlternativeId[] {
  const ranked: QuotaAlternativeId[] = [];
  for (const id of saved ?? []) {
    if (isQuotaAlternativeId(id) && !ranked.includes(id)) ranked.push(id);
  }
  for (const id of AGENT_FALLBACK_ORDER) {
    if (!ranked.includes(id)) ranked.push(id);
  }
  return ranked;
}

/** Parse/serialize the stored order. One column, comma separated, ids only. */
export function parseProviderOrder(stored: string | null | undefined): QuotaAlternativeId[] | null {
  if (!stored?.trim()) return null;
  const ids = stored
    .split(",")
    .map((s) => s.trim())
    .filter(isQuotaAlternativeId);
  return ids.length ? [...new Set(ids)] : null;
}

export function serializeProviderOrder(order: readonly string[]): string | null {
  const ids = order.filter(isQuotaAlternativeId);
  return ids.length ? [...new Set(ids)].join(",") : null;
}

export type ProviderRankInput = {
  /** The agent that just hit the wall. Excluded — switching to yourself is not a switch. */
  current?: string | null;
  /** The operator's preferred order (already parsed). Null = default order. */
  order?: readonly string[] | null;
  /**
   * Agent ids the connected builder reported installed. `null` or empty means
   * NOTHING WAS REPORTED, which is unknown, not unavailable — see the header.
   */
  installed?: readonly string[] | null;
  /** id → why it is spent, from `spentProviders`. */
  spent?: Readonly<Record<string, string>>;
};

/**
 * Every provider the operator could switch to, best first.
 *
 * Usable ones come first in the operator's order, then the ones that cannot
 * answer — also in that order, and never hidden. A provider silently missing
 * from the list is indistinguishable from a provider that does not exist, and
 * the operator's next question after "why is Codex not offered?" cannot be
 * answered by a list that omits it.
 */
export function rankProviders(input: ProviderRankInput): ProviderOption[] {
  const order = preferredProviderOrder(input.order);
  const current = (input.current ?? "").toLowerCase();
  const reported = input.installed && input.installed.length > 0 ? new Set(input.installed) : null;
  const spent = input.spent ?? {};

  const options = order
    .filter((id) => id !== current)
    .map((id): ProviderOption => {
      if (reported && !reported.has(id)) {
        return {
          id,
          label: providerLabel(id),
          usable: false,
          reason: `${providerLabel(id)} is not installed on the connected builder.`,
          block: "not-installed",
        };
      }
      const spentReason = spent[id];
      if (spentReason) {
        return {
          id,
          label: providerLabel(id),
          usable: false,
          reason: spentReason,
          block: "spent",
        };
      }
      return { id, label: providerLabel(id), usable: true, reason: null, block: null };
    });

  return [...options.filter((o) => o.usable), ...options.filter((o) => !o.usable)];
}

/** The one-tap target: the first provider in the operator's order that can answer. */
export function nextProvider(options: readonly ProviderOption[]): ProviderOption | null {
  return options.find((o) => o.usable) ?? null;
}

/**
 * Which agent this project would run on right now — the one to EXCLUDE.
 *
 * Not simply `agentPref`. A project that has never had a preference set still
 * dispatches, on the default adapter, and reading "current" as null there let
 * the chooser cheerfully offer Claude Code as the way out of a Claude Code rate
 * limit. So: what it last actually ran on, else what it would be told to run
 * on, else the fleet default.
 */
export function currentProviderFor(input: {
  agentPref?: string | null;
  /** Freshest-first runs for THIS project, as listRecentRuns returns them. */
  projectRuns?: readonly { adapter: string }[];
  defaultAdapter: string;
}): string {
  const lastRun = input.projectRuns?.find((r) => isQuotaAlternativeId(r.adapter))?.adapter;
  if (lastRun) return lastRun;
  if (input.agentPref && isQuotaAlternativeId(input.agentPref)) return input.agentPref;
  return input.defaultAdapter;
}

export type ProviderRunEvidence = {
  adapter: string;
  error?: string | null;
  startedAt: Date | string;
};

/**
 * Providers with a capacity wall inside the window, and the moment they hit it.
 *
 * Reads runs we already record. A run that failed for any OTHER reason is not
 * evidence about quota and must not remove a provider from the chooser —
 * "Codex crashed on a bad path once" is not "Codex has no quota".
 */
export function spentProviders(
  runs: readonly ProviderRunEvidence[],
  nowMs: number = Date.now(),
  windowMs: number = PROVIDER_SPENT_WINDOW_MS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const run of runs) {
    if (!isQuotaAlternativeId(run.adapter)) continue;
    if (out[run.adapter]) continue;
    const error = run.error?.trim();
    if (!error || !looksLikeAgentCapacityIssue(error)) continue;
    const at = run.startedAt instanceof Date ? run.startedAt.getTime() : Date.parse(run.startedAt);
    if (!Number.isFinite(at) || nowMs - at > windowMs) continue;
    out[run.adapter] =
      `${providerLabel(run.adapter)} hit a limit ${minutesAgo(nowMs - at)} — it may still be spent.`;
  }
  return out;
}

function minutesAgo(deltaMs: number): string {
  const mins = Math.max(1, Math.round(deltaMs / 60_000));
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

/** Every provider id a chooser may name — for API validation. */
export const PROVIDER_IDS: readonly QuotaAlternativeId[] = QUOTA_ALTERNATIVE_AGENTS.map(
  (a) => a.id,
);
