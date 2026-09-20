// Pure shaping for the Activity feed: turn raw dispatch + run rows into the
// events a person actually reads. No DB, no React — importable from tests.
//
// The problem this solves: a single unit of work writes TWO rows. The dispatch
// path inserts prompt_history (what was asked) and, for trackable intents, an
// orchestration_runs row (what happened). The feed rendered both, so every
// action appeared twice at the same minute — "sbb-lost-found · Next best" then
// "sbb-lost-found · Next best · waiting" — and neither copy was complete: the
// first had the ask with no outcome, the second an outcome with no ask.
// Reported from a phone 2026-08-26 as a log that says nothing.
//
// Here they are joined back into one event that answers all three questions a
// glance should answer: what did I ask for, what happened, and what now.

import { getAdapterLabel, getIntentLabel } from "@/config/control-intents";
import { promptDisplay, runStatus, type PromptDisplay } from "@/lib/activity-status";
import type { StatusTone } from "@/lib/constants/statuses";

/** How far apart a dispatch and its run may be recorded and still be the same
 *  work. Both rows are written in the same request handler, so real pairs land
 *  within milliseconds; the generous window absorbs clock skew between the
 *  control plane and a queued runner without ever reaching the NEXT dispatch of
 *  the same intent (autopilot's cadence is minutes, not seconds). */
export const CORRELATION_WINDOW_MS = 120_000;

export type ActivityOutcome =
  | "success"
  | "partial"
  | "error"
  | "timeout"
  | "hang"
  | "user_abort"
  | "unconfirmed"
  | "running"
  | "dispatched";

/** Reading order for the outcome filter — worst first, because triage is the
 *  reason anyone opens this page. */
export const ACTIVITY_OUTCOME_LABEL: Record<ActivityOutcome, string> = {
  error: "Failed",
  unconfirmed: "Never confirmed",
  timeout: "Timed out",
  hang: "Hung",
  user_abort: "Stopped",
  partial: "Partial",
  running: "Running",
  success: "Done",
  dispatched: "Sent",
};

export type RunVerification = { judge: string; met: boolean; gap?: string | null };

export type PromptSource = {
  id: string;
  projectKey: string;
  adapter: string;
  intent: string;
  customPrompt: string | null;
  resolvedPrompt: string | null;
  dispatchedAt: Date;
};

export type RunSource = {
  id: string;
  projectKey: string;
  adapter: string;
  intent: string;
  state: string | null;
  outcome: string | null;
  summary: {
    done?: string | null;
    next?: string | null;
    verification?: RunVerification | null;
  } | null;
  payload: { error?: string | null; resultText?: string | null } | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type LocalChatSource = {
  id: string;
  projectKey: string | null;
  gitBranch: string | null;
  promptText: string;
  occurredAt: Date;
};

export type ActivityEvent = {
  id: string;
  /** When the work was ASKED for — the anchor a person reasons about. */
  occurredAt: string;
  projectKey: string;
  agentLabel: string;
  intentLabel: string;
  /** Raw intent id, as stored — what a re-dispatch replays. The LABEL is for
   *  reading; only the id can be handed back to the dispatch pipeline. */
  intentId: string;
  status: StatusTone;
  outcome: ActivityOutcome;
  outcomeLabel: string;
  /** Wall-clock the run took, when it finished. */
  durationLabel: string | null;
  durationMs: number | null;
  /** What was asked. Null only for a run with no matching dispatch row. */
  ask: PromptDisplay | null;
  /** What the agent reported doing. */
  done: string | null;
  /** What it says comes next — the most actionable line in the feed. */
  next: string | null;
  /** Why it failed, when it did. Never truncated here: the UI decides. */
  error: string | null;
  verification: RunVerification | null;
  /** True for a locally-typed Claude Code prompt (captured, never dispatched). */
  isLocalChat: boolean;
  runId: string | null;
  promptId: string | null;
};

/** Human duration, e.g. "2m 14s" / "830ms" / "1h 3m". */
export function formatDuration(startMs: number, endMs: number): string | null {
  const ms = endMs - startMs;
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function runOutcome(run: RunSource): ActivityOutcome {
  const known: ActivityOutcome[] = [
    "success",
    "partial",
    "error",
    "timeout",
    "hang",
    "user_abort",
    "unconfirmed",
  ];
  if (run.outcome && (known as string[]).includes(run.outcome))
    return run.outcome as ActivityOutcome;
  if (run.payload?.error) return "error";
  if (!run.finishedAt) return "running";
  return "success";
}

/** Correlation key — the same triple both rows are written with. */
function pairKey(row: { projectKey: string; adapter: string; intent: string }): string {
  return `${row.projectKey} ${row.adapter} ${row.intent}`;
}

/**
 * Join dispatches to their runs, newest first.
 *
 * Each prompt is consumed at most once, by the CLOSEST run in time — so a burst
 * of three `next_best` dispatches to one project pairs 1:1 in order instead of
 * every run claiming the same first prompt. A dispatch with no run (queued, or
 * an intent that records no run) and a run with no dispatch (a resumed session)
 * both still render: neither half is dropped just because its partner is
 * missing, which is what a log is for.
 */
export function buildActivityEvents(input: {
  prompts: PromptSource[];
  runs: RunSource[];
  localChats?: LocalChatSource[];
  /** Real failure causes keyed by run id — beats the reaper's circular
   *  "timed out: exceeded max duration". */
  blockedReasons?: Map<string, string>;
}): ActivityEvent[] {
  const { prompts, runs, localChats = [], blockedReasons = new Map() } = input;

  const unclaimed = new Map<string, PromptSource[]>();
  for (const p of prompts) {
    const key = pairKey(p);
    const list = unclaimed.get(key) ?? [];
    list.push(p);
    unclaimed.set(key, list);
  }

  const claimPromptFor = (run: RunSource): PromptSource | null => {
    const list = unclaimed.get(pairKey(run));
    if (!list?.length) return null;
    const runMs = run.startedAt.getTime();
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < list.length; i++) {
      const delta = Math.abs(list[i].dispatchedAt.getTime() - runMs);
      if (delta <= CORRELATION_WINDOW_MS && delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) return null;
    return list.splice(bestIdx, 1)[0];
  };

  const events: ActivityEvent[] = [];

  for (const run of runs) {
    const prompt = claimPromptFor(run);
    const outcome = runOutcome(run);
    const rawError = (blockedReasons.get(run.id) || run.payload?.error || "").trim();
    const done = run.summary?.done?.trim() || null;
    const next = run.summary?.next?.trim() || null;
    const resultText = run.payload?.resultText?.trim() || null;
    events.push({
      id: `run:${run.id}`,
      // Anchor on the dispatch when we have it: "when did I ask for this" is
      // the question a timeline answers. Runs that finish an hour later must
      // not re-sort above the work someone kicked off since.
      occurredAt: (prompt?.dispatchedAt ?? run.startedAt).toISOString(),
      projectKey: run.projectKey,
      agentLabel: getAdapterLabel(run.adapter),
      intentLabel: getIntentLabel(run.intent),
      intentId: run.intent,
      status: runStatus(run),
      outcome,
      outcomeLabel: ACTIVITY_OUTCOME_LABEL[outcome],
      durationLabel: run.finishedAt
        ? formatDuration(run.startedAt.getTime(), run.finishedAt.getTime())
        : null,
      durationMs: run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
      ask: prompt ? promptDisplay(prompt) : null,
      done: done ?? (next ? null : resultText),
      next,
      error: rawError || null,
      verification: run.summary?.verification ?? null,
      isLocalChat: false,
      runId: run.id,
      promptId: prompt?.id ?? null,
    });
  }

  // Dispatches nothing ever ran — queued behind an offline builder, or an
  // intent that records no run. Showing them is the difference between "your
  // work is waiting" and silence.
  for (const list of unclaimed.values()) {
    for (const prompt of list) {
      events.push({
        id: `prompt:${prompt.id}`,
        occurredAt: prompt.dispatchedAt.toISOString(),
        projectKey: prompt.projectKey,
        agentLabel: getAdapterLabel(prompt.adapter),
        intentLabel: getIntentLabel(prompt.intent),
        intentId: prompt.intent,
        status: "neutral",
        outcome: "dispatched",
        outcomeLabel: ACTIVITY_OUTCOME_LABEL.dispatched,
        durationLabel: null,
        durationMs: null,
        ask: promptDisplay(prompt),
        done: null,
        next: null,
        error: null,
        verification: null,
        isLocalChat: false,
        runId: null,
        promptId: prompt.id,
      });
    }
  }

  for (const chat of localChats) {
    events.push({
      id: `local_chat:${chat.id}`,
      occurredAt: chat.occurredAt.toISOString(),
      projectKey: chat.projectKey ?? "(unscoped)",
      agentLabel: "Claude Code",
      intentLabel: chat.gitBranch ? `local chat - ${chat.gitBranch}` : "local chat",
      intentId: "custom",
      status: "neutral",
      outcome: "dispatched",
      outcomeLabel: "Typed",
      durationLabel: null,
      durationMs: null,
      ask: promptDisplay({ customPrompt: chat.promptText, resolvedPrompt: null, intent: "custom" }),
      done: null,
      next: null,
      error: null,
      verification: null,
      isLocalChat: true,
      runId: null,
      promptId: null,
    });
  }

  return events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

// ─── Triage ──────────────────────────────────────────────────────────────────

export const ACTIVITY_FILTERS = ["all", "attention", "running", "queued", "done"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export function normalizeActivityFilter(value: string | null | undefined): ActivityFilter {
  return ACTIVITY_FILTERS.includes(value as ActivityFilter) ? (value as ActivityFilter) : "all";
}

/** Outcomes that mean "a human should look at this". */
const NEEDS_ATTENTION: ReadonlySet<ActivityOutcome> = new Set<ActivityOutcome>([
  "error",
  "timeout",
  "hang",
  "partial",
  // A dispatch that never reached an agent is the most actionable of the lot:
  // nothing will retry it on its own, and the fault is in the delivery path
  // rather than in the work.
  "unconfirmed",
]);

export function eventNeedsAttention(event: ActivityEvent): boolean {
  return NEEDS_ATTENTION.has(event.outcome);
}

/**
 * Dispatched, and nothing has run it yet.
 *
 * Exported so the KPI tile, the tab tally and the filtered list are ONE rule.
 * The hero counted this in its own `else if` chain while the list had no way
 * to select it, so "49 Queued" was the largest number on the page and the only
 * one you could not open — every other tile beside it is a link. Two copies of
 * the rule would be worse than none: a count and a list that disagree teach
 * people not to trust either.
 *
 * Attention wins over queued, matching the order the summary already used: a
 * dispatch that never reached an agent is reported as needing you, not as
 * patiently waiting.
 */
export function eventIsQueued(event: ActivityEvent): boolean {
  return !eventNeedsAttention(event) && event.outcome === "dispatched" && !event.isLocalChat;
}

export function filterActivityEvents(
  events: ActivityEvent[],
  filter: ActivityFilter,
): ActivityEvent[] {
  if (filter === "all") return events;
  if (filter === "attention") return events.filter(eventNeedsAttention);
  if (filter === "running") return events.filter((e) => e.outcome === "running");
  if (filter === "queued") return events.filter(eventIsQueued);
  return events.filter((e) => e.outcome === "success");
}

export type ActivityTallies = {
  total: number;
  attention: number;
  running: number;
  queued: number;
  done: number;
};

export function tallyActivityEvents(events: ActivityEvent[]): ActivityTallies {
  return {
    total: events.length,
    attention: events.filter(eventNeedsAttention).length,
    running: events.filter((e) => e.outcome === "running").length,
    queued: events.filter(eventIsQueued).length,
    done: events.filter((e) => e.outcome === "success").length,
  };
}

/** Calendar-day buckets in feed order, so a date is never repeated 20 times. */
export function groupEventsByDay(
  events: ActivityEvent[],
): { day: string; events: ActivityEvent[] }[] {
  const groups: { day: string; events: ActivityEvent[] }[] = [];
  for (const event of events) {
    const day = event.occurredAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.events.push(event);
    else groups.push({ day, events: [event] });
  }
  return groups;
}
