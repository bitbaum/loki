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
export const NIGHT_APPROVAL = {
  /** The owner tapped yes on the evening's plan. */
  APPROVED: "approved",
  /** An allowance the owner set in advance covered it (Settings → Autopilot). */
  ALLOWANCE: "allowance",
  /** A plan was put in front of the owner and never approved — nothing was built. */
  NOT_APPROVED: "not_approved",
  /** The evening found nothing to build, so there was nothing to ask. */
  NOTHING_PLANNED: "nothing_planned",
} as const;
export type NightApproval = (typeof NIGHT_APPROVAL)[keyof typeof NIGHT_APPROVAL];

export type NightSummary = {
  budget: number;
  /** How the night was allowed to build. Absent on nights before the evening asked (2026-10-10). */
  approval?: NightApproval;
  /** `why` is the refusal when no run started — the tick log's reason, not the owner's note. */
  fixes: { feedbackId: string; projectName: string; runId: string | null; why?: string }[];
  reads: { projectName: string; runId: string | null }[];
  archived: number;
  /** Rows waiting for a shut laptop that were handed to the cloud. */
  rerouted: number;
  skipped: NightPlan["skipped"];
};

/** A refusal as one short clause: the first sentence, without the executor's
 *  "Injection failed:" prefix, capped — a morning note is read on a phone. */
function shortWhy(why: string | undefined): string | null {
  if (!why) return null;
  const clean = why.replace(/^[A-Za-z ]+failed:\s*/i, "").trim();
  const first = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const cut = first.replace(/[.]$/, "");
  return cut.length > 90 ? `${cut.slice(0, 89)}…` : cut;
}

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
  // A plan nobody said yes to is a fact the morning owes the owner — it is
  // the one case where "nothing" is the news, and the way to a night that
  // builds is one line away (Settings → Autopilot).
  if (s.approval === NIGHT_APPROVAL.NOT_APPROVED) {
    parts.push("built nothing (tonight's plan was not approved)");
  }
  const started = s.fixes.filter((f) => f.runId);
  // A yes that led nowhere is owed an answer too: the owner approved runs and
  // none began — say so, with the first refusal, instead of a silent morning.
  const planned = s.fixes.length + s.reads.length;
  const approved =
    s.approval === NIGHT_APPROVAL.APPROVED || s.approval === NIGHT_APPROVAL.ALLOWANCE;
  if (approved && planned > 0 && nightRunsStarted(s) === 0) {
    const why = shortWhy(s.fixes.find((f) => f.why)?.why);
    parts.push(
      `could not start the ${planned} ${planned === 1 ? "run" : "runs"} you approved${why ? ` (${why})` : ""}`,
    );
  }
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

// ─── The evening: say what tonight would do, and what it would cost, first ───

/** When the night runs (UTC). The evening plan's hour is the timer's alone
 *  (scripts/install-hetzner-crons.sh, 19:00 UTC) — nothing here depends on it. */
export const NIGHT_RUN_HOUR_UTC = 2;
export const NIGHT_RUN_MINUTE_UTC = 30;

/** The instant the night named `night` runs — on that morning, UTC. */
export function nightRunAt(night: string): Date {
  const hh = String(NIGHT_RUN_HOUR_UTC).padStart(2, "0");
  const mm = String(NIGHT_RUN_MINUTE_UTC).padStart(2, "0");
  return new Date(`${night}T${hh}:${mm}:00Z`);
}

/** The night the evening plans for: the morning of the next run after `now`. */
export function upcomingNight(now: Date): string {
  const d = new Date(now);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (minutes >= NIGHT_RUN_HOUR_UTC * 60 + NIGHT_RUN_MINUTE_UTC) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Tonight's proposal: the plan with names on it, made in the evening and
 * put in front of the owner before anything runs. "Nothing sneaky is done,
 * nothing without the user's knowledge, unless they were explicitly asked
 * how much they allow and for how long" (owner, 2026-10-10).
 */
export type NightProposal = {
  /** The night it is for — the morning it ends on, YYYY-MM-DD. */
  night: string;
  budget: number;
  fixes: { feedbackId: string; projectName: string; excerpt: string }[];
  reads: { projectId: string; projectName: string }[];
  /** Reports that would be filed away — free, and reversible with one tap. */
  archive: number;
  /** Candidates passed over, for the "why only two" question. */
  skipped: NightPlan["skipped"];
};

/** A run with what it cost, from the owner's own history. */
export type RunCostSample = {
  adapter: string;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
};

export type NightEstimate = {
  /** Runs the plan would start. */
  runs: number;
  /** Money, when the owner's runners report a price; null when none of the
   *  sample did (a subscription builder meters nothing). */
  totalUsd: number | null;
  perRunUsd: number | null;
  /** Tokens per run, averaged over the sample, when reported. */
  perRunTokens: number | null;
  /** How many past runs the figures rest on. 0 = a guess with nothing behind it. */
  sample: number;
};

/**
 * What tonight would cost, from what the owner's last runs cost. Honest in
 * both directions: a price only when the runners reported one, and the
 * sample size beside it so a figure from two runs reads as what it is.
 */
export function estimateNightCost(history: RunCostSample[], runs: number): NightEstimate {
  const priced = history.filter((r) => typeof r.costUsd === "number" && r.costUsd > 0);
  const tokened = history.filter(
    (r) => typeof r.tokensIn === "number" || typeof r.tokensOut === "number",
  );
  const perRunUsd = priced.length
    ? priced.reduce((n, r) => n + (r.costUsd as number), 0) / priced.length
    : null;
  const perRunTokens = tokened.length
    ? Math.round(
        tokened.reduce((n, r) => n + (r.tokensIn ?? 0) + (r.tokensOut ?? 0), 0) / tokened.length,
      )
    : null;
  return {
    runs,
    totalUsd: perRunUsd == null ? null : Math.round(perRunUsd * runs * 100) / 100,
    perRunUsd: perRunUsd == null ? null : Math.round(perRunUsd * 100) / 100,
    perRunTokens,
    sample: history.length,
  };
}

/** "$1.20 (from your last 20 runs)" / "no metered cost — your builder is on a subscription" / "no runs to go on". */
export function estimateText(e: NightEstimate): string {
  if (e.runs === 0) return "nothing to spend — no runs planned";
  if (e.sample === 0) return "no past runs to estimate from";
  if (e.totalUsd == null) {
    return `no metered cost — your builder reported no price on the last ${e.sample} ${e.sample === 1 ? "run" : "runs"}`;
  }
  const tokens = e.perRunTokens ? `, ~${Math.round(e.perRunTokens / 1000)}k tokens a run` : "";
  return `~$${e.totalUsd.toFixed(2)} (your last ${e.sample} runs averaged $${(e.perRunUsd as number).toFixed(2)}${tokens})`;
}

/**
 * The evening message: what would run, what it would cost, what is free.
 * One short paragraph for a phone; the card shows the same lines.
 */
export function nightProposalText(p: NightProposal, e: NightEstimate): string {
  const parts: string[] = [];
  if (p.fixes.length) {
    const names = [...new Set(p.fixes.map((f) => f.projectName))];
    parts.push(`${p.fixes.length} ${p.fixes.length === 1 ? "fix" : "fixes"} (${names.join(", ")})`);
  }
  if (p.reads.length) parts.push(`read ${p.reads.map((r) => r.projectName).join(", ")}`);
  const runs = p.fixes.length + p.reads.length;
  const free = p.archive
    ? ` Filing away ${p.archive} old ${p.archive === 1 ? "report" : "reports"} is free and one tap to undo.`
    : "";
  if (runs === 0) {
    return `Tonight Loki has nothing to build: no open report on a project that can take a run.${free}`;
  }
  return `Tonight Loki would start ${parts.join(" and ")} — ${runs} of ${p.budget} runs, ${estimateText(e)}.${free}`;
}

// ─── The allowance: the one way a night runs without asking ─────────────────

/** How far ahead an allowance may reach. */
export const NIGHT_ALLOW_MAX_DAYS = 365;

/** What Settings offers — "for how long", in the owner's words. 0 = ask every evening. */
export const NIGHT_ALLOW_CHOICES: readonly { days: number; label: string }[] = [
  { days: 0, label: "Ask me every evening" },
  { days: 7, label: "For a week" },
  { days: 30, label: "For a month" },
  { days: 90, label: "For three months" },
];

/**
 * The choice an allowance reads back as: the largest offered span that still
 * fits in what is left of it, so a week set six days ago still shows "a week"
 * and an expired one shows "ask me". Pure.
 */
export function allowanceDaysLeft(until: string | null, now = Date.now()): number {
  const t = until ? Date.parse(until) : NaN;
  if (Number.isNaN(t) || t <= now) return 0;
  const left = (t - now) / 86_400_000;
  let best = 0;
  for (const c of NIGHT_ALLOW_CHOICES) if (c.days > 0 && c.days <= left + 1) best = c.days;
  return best || NIGHT_ALLOW_CHOICES.find((c) => c.days > 0)!.days;
}

/** The approval row's title — one per night, which is also the dedupe key. */
export function nightActionTitle(night: string): string {
  return `Tonight's autopilot plan · ${night}`;
}

export type NightAllowanceVerdict =
  { auto: true; reason: string } | { auto: false; reason: string };

/**
 * May tonight's plan run without a tap? Only under an allowance the owner
 * set — "run without asking until <date>, up to $<cap> a night" — and only
 * when the estimate stays under the cap. An unmetered builder (no price
 * reported) is within any cap: there is nothing to exceed. Pure.
 */
export function nightAllowance(
  settings: { night_allow_until: string | null; night_cost_cap_usd: number | null },
  estimate: NightEstimate,
  now = Date.now(),
): NightAllowanceVerdict {
  const until = settings.night_allow_until ? Date.parse(settings.night_allow_until) : NaN;
  if (Number.isNaN(until) || until <= now) {
    return { auto: false, reason: "no allowance — the plan waits for your yes" };
  }
  const cap = settings.night_cost_cap_usd;
  if (cap != null && estimate.totalUsd != null && estimate.totalUsd > cap) {
    return {
      auto: false,
      reason: `estimated $${estimate.totalUsd.toFixed(2)} is over your $${cap.toFixed(2)} cap — the plan waits for your yes`,
    };
  }
  const day = new Date(until).toISOString().slice(0, 10);
  return {
    auto: true,
    reason: `allowed until ${day}${cap != null ? `, up to $${cap.toFixed(2)} a night` : ""}`,
  };
}
