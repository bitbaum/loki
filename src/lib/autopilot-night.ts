/**
 * The autopilot night — asked for in the evening, run at night.
 *
 * Evening (`crons/autopilot-plan`, 19:00 UTC) — `proposeNightFor`:
 *   what tonight would build and read, with names on it, and what it would
 *   cost from the owner's own last runs. If there is anything to run it goes
 *   into the approval queue as one `autopilot_plan` row: Approve / Reject on
 *   Control, Telegram and /approvals. Under an allowance the owner set in
 *   advance (Settings → Autopilot: "run without asking until <date>, up to
 *   $<cap> a night") the row is approved on their behalf and they are told so.
 *
 * Night (`crons/autopilot-night`, 02:30 UTC) — `runNightFor`:
 *   1. Unstick — rows waiting for a shut laptop go to the cloud builder. Free.
 *   2. File away — reports nobody started in three weeks, reason on the row.
 *      Free, and one tap to undo.
 *   3. Build and read — EXACTLY the approved plan, re-checked (still open, not
 *      busy, not paused), never more. No approved plan: nothing runs, and the
 *      morning says so.
 *   4. Note — one row in autopilot_nights, one line on Telegram and push.
 *
 * Owner, 2026-10-10: "nothing sneaky is done; nothing without the user's
 * knowledge, unless the user is explicitly asked how much they allow and for
 * how long." The free parts need no yes because they spend nothing and undo
 * in one tap; everything that starts an agent run waits for one.
 *
 * Every decision is `planNight` / `nightAllowance` (src/config/autopilot-
 * night.ts); this file gathers the facts and carries the plan out. The
 * per-project safety gates are the SAME ones Control's dispatch uses
 * (autopilot-eligibility). No model is called here: a fix is an agent run on
 * the owner's own builder (implementFeedback), a read is an agent run that
 * files findings through the widget API, and the note is assembled from
 * counts — which keeps the night inside scripts/test/no-free-background-ai.ts.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, orchestrationRuns, pendingCommands } from "@/db/schema";
import { logDebug } from "@/db/queries/debug-logs";
import { getBeaconSettings, getFleetAutopilotUserIds } from "@/db/queries/beacon-settings";
import { getUserProjects } from "@/db/queries/user-projects";
import { getRecentOutcomes, listRunCostSamples } from "@/db/queries/orchestration-runs";
import { getProjectState } from "@/db/queries/project-states";
import { getActiveWidgetToken } from "@/db/queries/widget-tokens";
import { archiveFeedbackWithReason, listUserFeedback } from "@/db/queries/site-feedback";
import { hasAutopilotNight, recordAutopilotNight } from "@/db/queries/autopilot-nights";
import {
  approveAction,
  claimApprovedActionsByType,
  expireDraft,
  getActionByTitle,
  giveUpApprovedAction,
  markActionExecuted,
} from "@/db/queries/actions";
import { recordActionAuditEvent } from "@/db/queries/control-audit-events";
import { ACTION_STATUS, ACTION_TYPE, ENTITY_TYPE, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { DEFAULT_AUTO_INJECT_MODE } from "@/lib/constants/control";
import { HOUR_MS } from "@/lib/constants/time";
import type { AutoInjectMode } from "@/config/beacon";
import {
  NIGHT_APPROVAL,
  estimateNightCost,
  nightActionTitle,
  nightAllowance,
  nightNoteText,
  nightProposalText,
  nightRunAt,
  planNight,
  upcomingNight,
  type NightApproval,
  type NightEstimate,
  type NightPlan,
  type NightProject,
  type NightProposal,
  type NightSummary,
} from "@/config/autopilot-night";
import { evaluateScheduledDispatch } from "@/lib/orchestration/autopilot-eligibility";
import { injectPrompt } from "@/lib/inject-core";
import { implementFeedback } from "@/lib/feedback/implement";
import { composeReviewPrompt } from "@/lib/feedback/ai-review-prompt";
import { rerouteQueuedToCloud } from "@/lib/reroute-queue";
import { enqueueAction } from "@/lib/actions/enqueue-action";
import { finalizeApproved } from "@/lib/actions/finalize-approved";
import { pushToUser } from "@/lib/push-fanout";
import { selfTelegramTarget, sendTelegramMessage } from "@/lib/actions/telegram-send";
import { APP_URL } from "@/config/brand";

/** A project with a run this recent is awake; the night leaves it alone. */
const AWAKE_WINDOW_HOURS = 2;
/** How long the night may hold a claimed plan before another tick may take it. */
const PLAN_LEASE_MINUTES = 60;
/** How much of a report's words the evening card shows. */
const EXCERPT_CHARS = 80;

export type NightTick = {
  night: string;
  users: number;
  summaries: { userId: string; summary: NightSummary; note: string | null }[];
};

/** YYYY-MM-DD in UTC — the night is named after the morning it ends on. */
export function nightKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Is the project awake, or refused by the dispatch gates? Same facts the idle
 * nudge checked, in one place: a run in the last two hours, an open command,
 * or the SSOT gates saying no.
 */
async function projectIsBusy(
  userId: string,
  projectName: string,
  mode: AutoInjectMode,
  now: number,
): Promise<boolean> {
  const awakeSince = new Date(now - AWAKE_WINDOW_HOURS * HOUR_MS);
  const [recentRun, openCommand] = await Promise.all([
    db
      .select({ id: orchestrationRuns.id })
      .from(orchestrationRuns)
      .where(
        and(
          eq(orchestrationRuns.userId, userId),
          eq(orchestrationRuns.projectKey, projectName),
          gt(orchestrationRuns.startedAt, awakeSince),
        ),
      )
      .limit(1),
    db
      .select({ id: pendingCommands.id })
      .from(pendingCommands)
      .where(
        and(
          eq(pendingCommands.userId, userId),
          sql`${pendingCommands.executedAt} IS NULL`,
          sql`${pendingCommands.payload}->>'projectKey' = ${projectName}`,
        ),
      )
      .limit(1),
  ]);
  if (recentRun.length > 0 || openCommand.length > 0) return true;
  const [state, outcomes] = await Promise.all([
    getProjectState(userId, projectName).catch(() => null),
    getRecentOutcomes(userId, projectName, { limit: 8 }).catch(() => []),
  ]);
  const decision = evaluateScheduledDispatch(state, {
    mode,
    recentOutcomes: outcomes.map((o) => o.outcome),
    nowMs: now,
  });
  return !decision || decision.action === "off";
}

async function gatherProjects(userId: string, userMode: AutoInjectMode, now: number) {
  const [rows, executable] = await Promise.all([
    db
      .select({
        id: entities.id,
        name: entities.name,
        autoInjectModeOverride: entities.autoInjectModeOverride,
        metadata: entities.metadata,
      })
      .from(entities)
      .where(and(eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.PROJECT))),
    getUserProjects(userId).catch(() => []),
  ]);
  const byName = new Map(executable.map((p) => [p.name.toLowerCase(), p]));
  const projects: NightProject[] = [];
  const liveUrlById = new Map<string, string>();
  for (const row of rows) {
    const exec = byName.get(row.name.toLowerCase());
    const paused = row.autoInjectModeOverride === "off";
    const mode = (row.autoInjectModeOverride as AutoInjectMode | null) ?? userMode;
    const runnable = !!(exec?.dirPath || exec?.gitUrl);
    const token = exec?.liveUrl ? await getActiveWidgetToken(userId, row.id) : null;
    if (exec?.liveUrl) liveUrlById.set(row.id, exec.liveUrl);
    projects.push({
      id: row.id,
      name: row.name,
      paused,
      runnable,
      readable: !!(exec?.liveUrl && token),
      lastReadAt:
        ((row.metadata as { lastSiteReadAt?: string } | null)?.lastSiteReadAt as string) ?? null,
      // Gates are only worth asking for a project that could take work.
      busy:
        paused || (!runnable && !exec?.liveUrl)
          ? false
          : await projectIsBusy(userId, row.name, mode, now),
    });
  }
  return { projects, liveUrlById };
}

/** Everything a plan rests on, gathered once — the evening and the night read the same facts. */
async function gatherFacts(userId: string, now: number) {
  const settings = await getBeaconSettings(userId);
  const userMode = (settings.auto_inject_mode ?? DEFAULT_AUTO_INJECT_MODE) as AutoInjectMode;
  const { projects, liveUrlById } = await gatherProjects(userId, userMode, now);
  const open = (await listUserFeedback(userId)).filter(
    (f) => f.userId === userId && f.status === FEEDBACK_STATUS.NEW,
  );
  const plan = planNight({
    budget: settings.night_runs,
    projects,
    reports: open.map((f) => ({
      id: f.id,
      projectId: f.projectId,
      createdAt: new Date(f.createdAt).toISOString(),
      duplicateCount: f.duplicateCount,
      source: f.source ?? null,
    })),
    now,
  });
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  return { settings, projects, liveUrlById, open, plan, nameOf };
}

type Facts = Awaited<ReturnType<typeof gatherFacts>>;

async function stampSiteRead(projectId: string, at: Date) {
  const [row] = await db
    .select({ metadata: entities.metadata })
    .from(entities)
    .where(eq(entities.id, projectId))
    .limit(1);
  await db
    .update(entities)
    .set({
      metadata: { ...(row?.metadata ?? {}), lastSiteReadAt: at.toISOString() },
      updatedAt: at,
    })
    .where(eq(entities.id, projectId));
}

// ─── The evening ─────────────────────────────────────────────────────────────

export type NightProposalOutcome = {
  proposal: NightProposal;
  estimate: NightEstimate;
  /** asked = waits for a tap · allowance = approved under the owner's allowance ·
   *  already_asked = tonight's row exists · nothing_planned = no runs, nothing to ask. */
  outcome: "asked" | "allowance" | "already_asked" | "nothing_planned";
  actionId: string | null;
};

function excerpt(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > EXCERPT_CHARS ? `${one.slice(0, EXCERPT_CHARS - 1)}…` : one;
}

function toProposal(night: string, f: Facts): NightProposal {
  const wordsOf = new Map(f.open.map((r) => [r.id, r.suggestion]));
  return {
    night,
    budget: f.settings.night_runs,
    fixes: f.plan.fixes.map((fx) => ({
      feedbackId: fx.feedbackId,
      projectName: f.nameOf.get(fx.projectId) ?? fx.projectId,
      excerpt: excerpt(wordsOf.get(fx.feedbackId) ?? ""),
    })),
    reads: f.plan.reads.map((r) => ({
      projectId: r.projectId,
      projectName: f.nameOf.get(r.projectId) ?? r.projectId,
    })),
    archive: f.plan.archive.length,
    skipped: f.plan.skipped,
  };
}

async function tellOwner(userId: string, title: string, body: string, tag: string) {
  const url = `${APP_URL}/control`;
  await Promise.all([
    pushToUser(userId, { title, body, url, tag }).catch(() => {}),
    (async () => {
      const target = selfTelegramTarget();
      if (!target) return;
      await sendTelegramMessage(target, `${title}\n${body}\n${url}`).catch(() => {});
    })(),
  ]);
}

/** One account's evening: the plan, its price, and the question — or the allowance. */
export async function proposeNightFor(
  userId: string,
  night: string,
  now = Date.now(),
): Promise<NightProposalOutcome> {
  const f = await gatherFacts(userId, now);
  const proposal = toProposal(night, f);
  const runs = proposal.fixes.length + proposal.reads.length;
  const estimate = estimateNightCost(await listRunCostSamples(userId).catch(() => []), runs);
  if (runs === 0) return { proposal, estimate, outcome: "nothing_planned", actionId: null };

  const verdict = nightAllowance(f.settings, estimate, now);
  const body = nightProposalText(proposal, estimate);
  // The row is written first, always — approved by a tap or by the allowance,
  // the queue is the record of what was asked and what was answered.
  const queued = await enqueueAction(
    userId,
    {
      type: ACTION_TYPE.AUTOPILOT_PLAN,
      title: nightActionTitle(night),
      description: body,
      payload: { night, proposal, estimate, body, allowed: verdict.auto },
      reasoning: verdict.reason,
      expiresAt: nightRunAt(night),
    },
    // The Telegram card with Approve / Reject goes out only when a tap is owed.
    { operatorRequested: !verdict.auto },
  );
  if (queued.result === "deduped") {
    return { proposal, estimate, outcome: "already_asked", actionId: null };
  }
  const row = queued.action;
  if (!verdict.auto) {
    await pushToUser(userId, {
      title: "Tonight's plan — your yes?",
      body,
      url: `${APP_URL}/control`,
      tag: "autopilot-plan",
    }).catch(() => {});
    return { proposal, estimate, outcome: "asked", actionId: row.id };
  }
  // An allowance is approval given in advance: same transition, same audit
  // trail, and the owner hears about it the evening before, not the morning after.
  const [approved] = await approveAction(row.id, userId);
  if (approved) await finalizeApproved(userId, approved, { via: "standing-rule" });
  await tellOwner(
    userId,
    `Tonight runs without asking (${verdict.reason})`,
    body,
    "autopilot-plan",
  );
  return { proposal, estimate, outcome: "allowance", actionId: row.id };
}

/** The whole fleet's evening. One row per (user, night) by the title's dedupe. */
export async function proposeAutopilotNight(now = new Date()) {
  const night = upcomingNight(now);
  const userIds = await getFleetAutopilotUserIds();
  const outcomes: { userId: string; outcome: NightProposalOutcome["outcome"]; runs: number }[] = [];
  for (const userId of userIds) {
    try {
      const r = await proposeNightFor(userId, night, now.getTime());
      outcomes.push({ userId, outcome: r.outcome, runs: r.estimate.runs });
    } catch (e) {
      await logDebug({
        source: "crons/autopilot-plan",
        level: "error",
        message: `Evening plan failed for a user: ${(e as Error).message}`,
        meta: { userId, night },
      });
    }
  }
  return { night, users: userIds.length, outcomes };
}

// ─── The night ───────────────────────────────────────────────────────────────

/**
 * Tonight's approved plan, claimed so a second tick cannot run it twice. A
 * plan for a PAST night that was approved too late is retired here: a yes
 * given on Tuesday afternoon must not start Monday's runs on Wednesday.
 */
async function claimTonight(userId: string, night: string) {
  const claimed = await claimApprovedActionsByType(
    userId,
    ACTION_TYPE.AUTOPILOT_PLAN,
    PLAN_LEASE_MINUTES,
    5,
  );
  let tonight: (typeof claimed)[number] | null = null;
  for (const c of claimed) {
    if (!tonight && c.payload?.night === night) tonight = c;
    else await giveUpApprovedAction(c.id, userId);
  }
  return tonight;
}

/** The plan was put in front of the owner and not approved — or never made. */
async function settleUnapproved(userId: string, night: string): Promise<NightApproval> {
  const row = await getActionByTitle(userId, nightActionTitle(night));
  if (!row) return NIGHT_APPROVAL.NOTHING_PLANNED;
  if (row.status === ACTION_STATUS.DRAFT) await expireDraft(row.id);
  return NIGHT_APPROVAL.NOT_APPROVED;
}

async function startFixes(userId: string, fixes: NightProposal["fixes"], f: Facts) {
  const stillOpen = new Set(f.open.map((r) => r.id));
  const byName = new Map(f.projects.map((p) => [p.name, p]));
  const out: NightSummary["fixes"] = [];
  for (const fix of fixes) {
    const project = byName.get(fix.projectName);
    const why = !stillOpen.has(fix.feedbackId)
      ? "the report was closed or taken since the plan was made"
      : !project || project.paused || project.busy
        ? "the project was paused or busy at run time"
        : null;
    if (why) {
      out.push({ feedbackId: fix.feedbackId, projectName: fix.projectName, runId: null, why });
      continue;
    }
    try {
      const { body } = await implementFeedback(userId, fix.feedbackId);
      const runId = typeof body.runId === "string" ? body.runId : null;
      const err = typeof body.error === "string" ? body.error : undefined;
      out.push({
        feedbackId: fix.feedbackId,
        projectName: fix.projectName,
        runId,
        ...(err ? { why: err } : {}),
      });
    } catch (e) {
      out.push({
        feedbackId: fix.feedbackId,
        projectName: fix.projectName,
        runId: null,
        why: (e as Error).message,
      });
    }
  }
  return out;
}

async function startReads(userId: string, reads: NightProposal["reads"], f: Facts, now: number) {
  const byId = new Map(f.projects.map((p) => [p.id, p]));
  const out: NightSummary["reads"] = [];
  for (const read of reads) {
    const project = byId.get(read.projectId);
    const liveUrl = f.liveUrlById.get(read.projectId);
    const token = await getActiveWidgetToken(userId, read.projectId);
    if (!project || project.paused || project.busy || !liveUrl || !token) {
      out.push({ projectName: read.projectName, runId: null });
      continue;
    }
    try {
      const { status, body } = await injectPrompt(
        {
          tab: project.name,
          projectId: read.projectId,
          customPrompt: composeReviewPrompt(liveUrl, project.name, token.token),
        },
        userId,
      );
      const runId = status < 400 && typeof body.runId === "string" ? body.runId : null;
      if (runId) await stampSiteRead(read.projectId, new Date(now));
      out.push({ projectName: read.projectName, runId });
    } catch {
      out.push({ projectName: read.projectName, runId: null });
    }
  }
  return out;
}

/** One account's night. Exported for the cron and for a manual replay. */
export async function runNightFor(userId: string, night: string, now = Date.now()) {
  const f = await gatherFacts(userId, now);

  // 1. Unstick. A refusal (cloud private, cloud offline) is not a failure of
  // the night — the rows wait where they were.
  const reroute = await rerouteQueuedToCloud(userId).catch(() => null);
  const rerouted = reroute?.ok ? reroute.rerouted : 0;

  // 2. File away — from tonight's facts, not the evening's: a report reopened
  // since is kept. Free, and one tap to undo.
  const archived = await archiveFeedbackWithReason(
    userId,
    f.plan.archive.map((a) => a.id),
    f.plan.archive[0]?.reason ?? "",
  );

  // 3. Build and read — only what was approved, and only what still holds.
  let approval: NightApproval;
  let fixes: NightSummary["fixes"] = [];
  let reads: NightSummary["reads"] = [];
  const tonight = await claimTonight(userId, night);
  if (tonight) {
    const p = tonight.payload as { proposal?: NightProposal; allowed?: boolean };
    approval = p.allowed ? NIGHT_APPROVAL.ALLOWANCE : NIGHT_APPROVAL.APPROVED;
    fixes = await startFixes(userId, p.proposal?.fixes ?? [], f);
    reads = await startReads(userId, p.proposal?.reads ?? [], f, now);
    const done = await markActionExecuted(tonight.id, userId);
    if (done) await recordActionAuditEvent(userId, done, "executed");
  } else {
    approval = await settleUnapproved(userId, night);
  }

  const skipped: NightPlan["skipped"] = f.plan.skipped;
  const summary: NightSummary = {
    budget: f.settings.night_runs,
    approval,
    fixes,
    reads,
    archived,
    rerouted,
    skipped,
  };
  await recordAutopilotNight(userId, night, summary);

  // 4. Note — silence when the night did nothing.
  const note = nightNoteText(summary);
  if (note) {
    const url = `${APP_URL}/feedback`;
    await Promise.all([
      pushToUser(userId, { title: "While you were away", body: note, url, tag: "autopilot-night" }),
      (async () => {
        const target = selfTelegramTarget();
        if (!target) return;
        await sendTelegramMessage(target, `${note}\n${url}`).catch(() => {});
      })(),
    ]);
  }
  return { summary, note };
}

/** The whole fleet's night. Idempotent per (user, night). */
export async function runAutopilotNight(now = new Date()): Promise<NightTick> {
  const night = nightKey(now);
  const userIds = await getFleetAutopilotUserIds();
  const summaries: NightTick["summaries"] = [];
  for (const userId of userIds) {
    if (await hasAutopilotNight(userId, night)) continue;
    try {
      const { summary, note } = await runNightFor(userId, night, now.getTime());
      summaries.push({ userId, summary, note });
    } catch (e) {
      await logDebug({
        source: "crons/autopilot-night",
        level: "error",
        message: `Night failed for a user: ${(e as Error).message}`,
        meta: { userId, night },
      });
    }
  }
  return { night, users: userIds.length, summaries };
}
