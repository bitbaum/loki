/**
 * The autopilot night, run once per account per night by `crons/autopilot-night`.
 *
 *   1. Unstick — rows waiting for a shut laptop go to the cloud builder.
 *   2. File away — reports nobody started in three weeks, with the reason on the row.
 *   3. Build — from the inbox, under the account's run budget, one lane per project.
 *   4. Read — one site not read this week, when there is budget left.
 *   5. Note — one row in autopilot_nights, one line on Telegram and push.
 *
 * Every decision is `planNight` (src/config/autopilot-night.ts); this file
 * only gathers the facts and carries the plan out. The per-project safety
 * gates are the SAME ones Control's dispatch and the old idle nudge used
 * (autopilot-eligibility): an agent that said `working` or `blocked`, a no-op
 * loop, a failure streak, or a paused project takes nothing.
 *
 * No model is called here. A fix is an agent run on the owner's own builder
 * (implementFeedback); a read is an agent run that files findings through the
 * widget API; the note is assembled from counts. That is what keeps the night
 * inside scripts/test/no-free-background-ai.ts.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, orchestrationRuns, pendingCommands } from "@/db/schema";
import { logDebug } from "@/db/queries/debug-logs";
import { getBeaconSettings, getFleetAutopilotUserIds } from "@/db/queries/beacon-settings";
import { getUserProjects } from "@/db/queries/user-projects";
import { getRecentOutcomes } from "@/db/queries/orchestration-runs";
import { getProjectState } from "@/db/queries/project-states";
import { getActiveWidgetToken } from "@/db/queries/widget-tokens";
import { archiveFeedbackWithReason, listUserFeedback } from "@/db/queries/site-feedback";
import { hasAutopilotNight, recordAutopilotNight } from "@/db/queries/autopilot-nights";
import { ENTITY_TYPE, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { DEFAULT_AUTO_INJECT_MODE } from "@/lib/constants/control";
import { HOUR_MS } from "@/lib/constants/time";
import type { AutoInjectMode } from "@/config/beacon";
import {
  nightNoteText,
  planNight,
  type NightProject,
  type NightSummary,
} from "@/config/autopilot-night";
import { evaluateScheduledDispatch } from "@/lib/orchestration/autopilot-eligibility";
import { injectPrompt } from "@/lib/inject-core";
import { implementFeedback } from "@/lib/feedback/implement";
import { composeReviewPrompt } from "@/lib/feedback/ai-review-prompt";
import { rerouteQueuedToCloud } from "@/lib/reroute-queue";
import { pushToUser } from "@/lib/push-fanout";
import { selfTelegramTarget, sendTelegramMessage } from "@/lib/actions/telegram-send";
import { APP_URL } from "@/config/brand";

/** A project with a run this recent is awake; the night leaves it alone. */
const AWAKE_WINDOW_HOURS = 2;

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

/** One account's night. Exported for the cron and for a manual replay. */
export async function runNightFor(userId: string, night: string, now = Date.now()) {
  const settings = await getBeaconSettings(userId);
  const userMode = (settings.auto_inject_mode ?? DEFAULT_AUTO_INJECT_MODE) as AutoInjectMode;

  // 1. Unstick. A refusal (cloud private, cloud offline) is not a failure of
  // the night — the rows wait where they were.
  const reroute = await rerouteQueuedToCloud(userId).catch(() => null);
  const rerouted = reroute?.ok ? reroute.rerouted : 0;

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

  // 2. File away.
  const archived = await archiveFeedbackWithReason(
    userId,
    plan.archive.map((a) => a.id),
    plan.archive[0]?.reason ?? "",
  );

  // 3. Build — through the same path as the Implement button, so a night's
  // run is a person's run: same prompt, same auto-ship rules, same ledger.
  const fixes: NightSummary["fixes"] = [];
  for (const fix of plan.fixes) {
    const projectName = nameOf.get(fix.projectId) ?? fix.projectId;
    try {
      const { body } = await implementFeedback(userId, fix.feedbackId);
      const runId = typeof body.runId === "string" ? body.runId : null;
      const why = typeof body.error === "string" ? body.error : undefined;
      fixes.push({ feedbackId: fix.feedbackId, projectName, runId, ...(why ? { why } : {}) });
    } catch (e) {
      fixes.push({
        feedbackId: fix.feedbackId,
        projectName,
        runId: null,
        why: (e as Error).message,
      });
    }
  }

  // 4. Read.
  const reads: NightSummary["reads"] = [];
  for (const read of plan.reads) {
    const projectName = nameOf.get(read.projectId) ?? read.projectId;
    const liveUrl = liveUrlById.get(read.projectId);
    const token = await getActiveWidgetToken(userId, read.projectId);
    if (!liveUrl || !token) continue;
    try {
      const { status, body } = await injectPrompt(
        {
          tab: projectName,
          projectId: read.projectId,
          customPrompt: composeReviewPrompt(liveUrl, projectName, token.token),
        },
        userId,
      );
      const runId = status < 400 && typeof body.runId === "string" ? body.runId : null;
      if (runId) await stampSiteRead(read.projectId, new Date(now));
      reads.push({ projectName, runId });
    } catch {
      reads.push({ projectName, runId: null });
    }
  }

  const summary: NightSummary = {
    budget: settings.night_runs,
    fixes,
    reads,
    archived,
    rerouted,
    skipped: plan.skipped,
  };
  await recordAutopilotNight(userId, night, summary);

  // 5. Note — silence when the night did nothing.
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
