/**
 * The autopilot night — SSOT for what Loki does on its own while the owner
 * sleeps, and the one limit on what it may spend.
 *
 * Until 2026-10-10 the night was `nudge-idle`: wake up to three idle projects
 * at 04:00 with a generic "pick the highest-impact action" prompt. Runs with
 * no brief produced work nobody asked for and a queue of guesses the owner
 * then had to clear by hand ("a lot of that stuff is garbage"). The night now
 * works from what people actually said — the feedback inbox — and reads one
 * site to find the next thing, so every run has a specific ask behind it.
 *
 * Budget is counted in RUNS, not money. A run is the unit that spends the
 * owner's agent credits, and a run cap holds whether or not the runner
 * reports a price (Claude Code on a subscription reports none). Spend in
 * dollars is shown afterwards where it is known, never used as the gate.
 *
 * Pure: the planner takes facts and returns a plan. The lib runs it.
 */

/** Runs a night may start, for an account that has never chosen. */
export const NIGHT_RUNS_DEFAULT = 4;
/** Runs a night may start, at most, whatever the setting says. */
export const NIGHT_RUNS_MAX = 20;
/** A report nobody started in this long is filed away, with the reason on the row. */
export const STALE_REPORT_DAYS = 21;
/** A site is read again no sooner than this. */
export const SITE_READ_EVERY_DAYS = 7;
/** Reads per night — a read files findings that cost runs on later nights. */
export const READS_PER_NIGHT = 1;

export const STALE_REPORT_REASON = `Nobody started this in ${STALE_REPORT_DAYS} days. Reopen it to keep it.`;

const DAY_MS = 24 * 60 * 60_000;

export type NightProject = {
  /** Entity id. */
  id: string;
  name: string;
  /** Per-project autopilot override is off. */
  paused: boolean;
  /** Has a folder or a repository — somewhere for an agent to work. */
  runnable: boolean;
  /** Has a public URL and a widget token — a site Loki can read and file on. */
  readable: boolean;
  /** ISO — when the site was last read by autopilot. */
  lastReadAt: string | null;
  /** A run started recently, a command is open, or the dispatch gates refuse. */
  busy: boolean;
};

export type NightReport = {
  id: string;
  projectId: string;
  /** ISO */
  createdAt: string;
  duplicateCount: number;
  /** visitor | owner | ai_review | synthesizer | null (legacy visitor). */
  source: string | null;
};

export type NightPlan = {
  /** Reports to file away, with the reason that goes on the row. */
  archive: { id: string; reason: string }[];
  /** Reports to build, in order, one per project. */
  fixes: { feedbackId: string; projectId: string }[];
  /** Sites to read. */
  reads: { projectId: string }[];
  /** Why candidates were passed over — the tick log, so a quiet night is explainable. */
  skipped: Record<"paused" | "busy" | "not_runnable" | "lane_taken" | "over_budget", number>;
};

/** Owner notes first (the owner asked), then what most visitors hit, then the newest. */
function reportPriority(r: NightReport): number {
  const own = r.source === "owner" ? 1_000_000 : 0;
  return own + r.duplicateCount * 1000;
}

export function planNight(input: {
  budget: number;
  projects: NightProject[];
  /** Open reports with status `new` — nothing started, nothing filed. */
  reports: NightReport[];
  now?: number;
}): NightPlan {
  const now = input.now ?? Date.now();
  const budget = Math.max(0, Math.min(NIGHT_RUNS_MAX, Math.floor(input.budget)));
  const byId = new Map(input.projects.map((p) => [p.id, p]));
  const skipped: NightPlan["skipped"] = {
    paused: 0,
    busy: 0,
    not_runnable: 0,
    lane_taken: 0,
    over_budget: 0,
  };

  // Filing away is free and happens whatever the budget: a report nobody
  // started in three weeks is the queue the owner called garbage.
  const staleBefore = now - STALE_REPORT_DAYS * DAY_MS;
  const archive: NightPlan["archive"] = [];
  const fresh: NightReport[] = [];
  for (const r of input.reports) {
    if (Date.parse(r.createdAt) < staleBefore)
      archive.push({ id: r.id, reason: STALE_REPORT_REASON });
    else fresh.push(r);
  }

  const fixes: NightPlan["fixes"] = [];
  const lanes = new Set<string>();
  const ordered = [...fresh].sort(
    (a, b) => reportPriority(b) - reportPriority(a) || b.createdAt.localeCompare(a.createdAt),
  );
  for (const r of ordered) {
    const p = byId.get(r.projectId);
    if (!p) continue;
    if (p.paused) {
      skipped.paused++;
      continue;
    }
    if (!p.runnable) {
      skipped.not_runnable++;
      continue;
    }
    if (p.busy) {
      skipped.busy++;
      continue;
    }
    if (lanes.has(p.id)) {
      skipped.lane_taken++;
      continue;
    }
    if (fixes.length >= budget) {
      skipped.over_budget++;
      continue;
    }
    fixes.push({ feedbackId: r.id, projectId: p.id });
    lanes.add(p.id);
  }

  // A read only when there is budget left after the fixes, on a site not
  // read this week and not already in a lane tonight — longest unread first.
  const reads: NightPlan["reads"] = [];
  const readBefore = now - SITE_READ_EVERY_DAYS * DAY_MS;
  const readable = input.projects
    .filter((p) => p.readable && !p.paused && !p.busy && !lanes.has(p.id))
    .filter((p) => !p.lastReadAt || Date.parse(p.lastReadAt) < readBefore)
    .sort((a, b) => (a.lastReadAt ?? "").localeCompare(b.lastReadAt ?? ""));
  for (const p of readable) {
    if (reads.length >= READS_PER_NIGHT) break;
    if (fixes.length + reads.length >= budget) {
      skipped.over_budget++;
      break;
    }
    reads.push({ projectId: p.id });
  }

  return { archive, fixes, reads, skipped };
}

/** What a night did — stored per (user, night) and read back as the morning note. */
export type NightSummary = {
  budget: number;
  /** `why` is the refusal when no run started — the tick log's reason, not the owner's note. */
  fixes: { feedbackId: string; projectName: string; runId: string | null; why?: string }[];
  reads: { projectName: string; runId: string | null }[];
  archived: number;
  /** Rows waiting for a shut laptop that were handed to the cloud. */
  rerouted: number;
  skipped: NightPlan["skipped"];
};

/** Runs the night actually started. */
export function nightRunsStarted(s: NightSummary): number {
  return s.fixes.filter((f) => f.runId).length + s.reads.filter((r) => r.runId).length;
}

/**
 * The morning note, one sentence, from the summary. Returns null when the
 * night did nothing — a note that says "nothing" every morning is the digest
 * worth ignoring, and silence when fine is the rule.
 */
export function nightNoteText(s: NightSummary, spentUsd?: number | null): string | null {
  const parts: string[] = [];
  const started = s.fixes.filter((f) => f.runId);
  if (started.length) {
    const names = [...new Set(started.map((f) => f.projectName))];
    parts.push(
      `started ${started.length} ${started.length === 1 ? "fix" : "fixes"} (${names.join(", ")})`,
    );
  }
  const read = s.reads.filter((r) => r.runId);
  if (read.length) parts.push(`read ${read.map((r) => r.projectName).join(", ")}`);
  if (s.archived)
    parts.push(`filed away ${s.archived} old ${s.archived === 1 ? "report" : "reports"}`);
  if (s.rerouted) parts.push(`moved ${s.rerouted} to the cloud`);
  if (parts.length === 0) return null;
  const runs = nightRunsStarted(s);
  const tail = [
    `${runs} of ${s.budget} runs`,
    spentUsd != null && spentUsd > 0 ? `$${spentUsd.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const body = parts.join(", ");
  return `Last night Loki ${body[0]}${body.slice(1)} · ${tail}.`;
}
