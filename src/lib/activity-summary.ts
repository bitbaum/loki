// What the Activity page LEADS with: the shape of the window, not its contents.
// Pure — no DB, no React — so every number here is testable.
//
// The feed answers "what happened, item by item". It cannot answer the
// questions someone actually opens this page with at 9am: did anything break,
// did we move, and is the fleet still working? Those need aggregates, a
// comparison against the previous window, and a sentence that commits to a
// point of view. That is this file.

import type { ActivityEvent } from "@/lib/activity-events";
import { eventNeedsAttention, eventIsQueued } from "@/lib/activity-events";

// ─── Headline KPIs ───────────────────────────────────────────────────────────

export type ActivitySummary = {
  /** Runs that finished cleanly. */
  shipped: number;
  /** Failed, timed out, hung, or came back partial. */
  attention: number;
  /** Still going right now. */
  running: number;
  /** Dispatched with no run recorded yet — queued, or waiting on a builder. */
  queued: number;
  /** Distinct projects with any event in the window. */
  projects: number;
  /** Summed wall-clock of every finished run. The one number that says how
   *  much work the fleet actually did, rather than how many rows it wrote. */
  agentMs: number;
  agentLabel: string | null;
  /** The project with the most events, when one clearly leads. */
  busiestProject: string | null;
};

/** Compact wall-clock for a total, e.g. "4h 12m" / "38m" / "under a minute". */
export function formatAgentTime(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  // Tested on raw ms, not on the rounded minutes: Math.round(30s) is 1, so
  // rounding first reported half a minute of work as "1m".
  if (ms < 60_000) return "under a minute";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function summarizeActivity(events: ActivityEvent[]): ActivitySummary {
  const perProject = new Map<string, number>();
  let agentMs = 0;
  let shipped = 0;
  let attention = 0;
  let running = 0;
  let queued = 0;

  for (const event of events) {
    perProject.set(event.projectKey, (perProject.get(event.projectKey) ?? 0) + 1);
    if (event.durationMs && event.durationMs > 0) agentMs += event.durationMs;
    if (eventNeedsAttention(event)) attention += 1;
    else if (event.outcome === "success") shipped += 1;
    else if (event.outcome === "running") running += 1;
    else if (eventIsQueued(event)) queued += 1;
  }

  let busiestProject: string | null = null;
  let busiestCount = 0;
  let tied = false;
  for (const [project, count] of perProject) {
    if (count > busiestCount) {
      busiestProject = project;
      busiestCount = count;
      tied = false;
    } else if (count === busiestCount) {
      tied = true;
    }
  }

  return {
    shipped,
    attention,
    running,
    queued,
    projects: perProject.size,
    agentMs,
    agentLabel: formatAgentTime(agentMs),
    // A "busiest" that is tied with another project is not a fact worth
    // printing — it would name one arbitrarily.
    busiestProject: tied ? null : busiestProject,
  };
}

// ─── Momentum ────────────────────────────────────────────────────────────────

export type ActivityMomentum = {
  /** Actions this window vs the one before it. */
  current: number;
  previous: number;
  /** Positive = busier than last window. Null when there is no basis. */
  deltaPct: number | null;
  /** Ready-to-print phrase, or null when saying nothing is more honest. */
  label: string | null;
};

/**
 * How this window compares to the one before it.
 *
 * Deliberately conservative about percentages, because a percentage carries
 * more authority than its base usually deserves. Going from 1 action to 2 is
 * "+100%" and means nothing. So a percentage is only quoted once the PREVIOUS
 * window had a real base (3+); below that the comparison is qualitative, and
 * two tiny windows say nothing at all rather than manufacture a trend.
 */
const MOMENTUM_MIN_BASE = 3;
const MOMENTUM_MIN_SWING_PCT = 15;

export function computeMomentum(current: number, previous: number): ActivityMomentum {
  if (previous === 0 && current === 0) {
    return { current, previous, deltaPct: null, label: null };
  }
  if (previous === 0) {
    return { current, previous, deltaPct: null, label: "first activity after a quiet window" };
  }

  const deltaPct = Math.round(((current - previous) / previous) * 100);
  const delta = current - previous;

  // Base too small for a number to mean anything — describe, don't quantify.
  if (previous < MOMENTUM_MIN_BASE) {
    if (Math.abs(delta) < MOMENTUM_MIN_BASE) {
      return { current, previous, deltaPct, label: "about the same as last window" };
    }
    return {
      current,
      previous,
      deltaPct,
      label: delta > 0 ? "busier than last window" : "quieter than last window",
    };
  }

  if (Math.abs(deltaPct) < MOMENTUM_MIN_SWING_PCT) {
    return { current, previous, deltaPct, label: "about the same as last window" };
  }
  return {
    current,
    previous,
    deltaPct,
    label:
      deltaPct > 0
        ? `${deltaPct}% busier than last window`
        : `${Math.abs(deltaPct)}% quieter than last window`,
  };
}

// ─── The pulse ───────────────────────────────────────────────────────────────

export type PulseBucket = {
  /** Bucket start, ISO. */
  startsAt: string;
  /** Every event in this slice of time. */
  total: number;
  /** How many of those need a human. Drives the failure tick, NOT a colour:
   *  see ActivityPulse for why outcome is never encoded by hue here. */
  attention: number;
};

export type ActivityPulse = {
  buckets: PulseBucket[];
  /** Largest bucket, so the view can scale bars without a second pass. */
  peak: number;
  /** Bucket width in ms — the view labels the axis from this. */
  bucketMs: number;
};

/** How many bars each window is drawn with. Chosen so one bar is a unit a
 *  person actually thinks in: 5 minutes, an hour, a day. */
export function pulseBucketCount(windowKey: string): number {
  if (windowKey === "hour") return 12;
  if (windowKey === "day") return 24;
  if (windowKey === "week") return 7;
  return 30;
}

/**
 * Bucket events across the window so the page can show WHEN the fleet worked.
 *
 * Buckets are fixed-width and always fully populated (zeros included) — a pulse
 * with gaps silently omitted would read as continuous work, which is exactly
 * the lie this chart exists to prevent.
 */
export function buildActivityPulse(
  events: ActivityEvent[],
  sinceIso: string,
  untilIso: string,
  bucketCount: number,
): ActivityPulse {
  const since = Date.parse(sinceIso);
  const until = Date.parse(untilIso);
  const span = until - since;
  const safeCount = Math.max(1, Math.floor(bucketCount));
  if (!Number.isFinite(span) || span <= 0) {
    return { buckets: [], peak: 0, bucketMs: 0 };
  }
  const bucketMs = span / safeCount;

  const buckets: PulseBucket[] = Array.from({ length: safeCount }, (_, i) => ({
    startsAt: new Date(since + i * bucketMs).toISOString(),
    total: 0,
    attention: 0,
  }));

  for (const event of events) {
    const at = Date.parse(event.occurredAt);
    if (!Number.isFinite(at)) continue;
    // Clamp rather than drop: an event a second outside the boundary belongs to
    // the edge bucket, and losing it would make the bars disagree with the
    // count printed directly above them.
    const idx = Math.min(safeCount - 1, Math.max(0, Math.floor((at - since) / bucketMs)));
    buckets[idx].total += 1;
    if (eventNeedsAttention(event)) buckets[idx].attention += 1;
  }

  return {
    buckets,
    peak: buckets.reduce((max, b) => Math.max(max, b.total), 0),
    bucketMs,
  };
}

// ─── The headline ────────────────────────────────────────────────────────────

/**
 * One sentence that commits to what this window was.
 *
 * Ordered by what a person needs to hear first: something is broken > something
 * is in flight > something shipped > nothing happened. It never congratulates a
 * window that also contains failures — leading with "3 shipped" while one
 * project is on fire is how a dashboard loses trust.
 */
export function activityHeadline(summary: ActivitySummary): string {
  const { shipped, attention, running, queued, projects } = summary;

  if (attention > 0) {
    const subject = attention === 1 ? "1 thing needs you" : `${attention} things need you`;
    if (shipped > 0) {
      return `${subject} — and ${shipped} ${shipped === 1 ? "task" : "tasks"} shipped anyway.`;
    }
    return `${subject}.`;
  }
  if (shipped > 0) {
    const where = projects === 1 ? "on one project" : `across ${projects} projects`;
    const tail = running > 0 ? ` ${running} still running.` : "";
    return `${shipped} ${shipped === 1 ? "task" : "tasks"} shipped ${where}.${tail}`;
  }
  if (running > 0) {
    return `${running} ${running === 1 ? "agent is" : "agents are"} working right now.`;
  }
  if (queued > 0) {
    return `${queued} ${queued === 1 ? "dispatch is" : "dispatches are"} waiting on a builder.`;
  }
  return "Nothing ran in this window.";
}
