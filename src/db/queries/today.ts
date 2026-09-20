import {
  DEFAULT_USER_EXTERNAL_ID,
  GOALS_DUE_SOON_DAYS,
  EVENTS_DUE_SOON_DAYS,
  SUBSCRIPTIONS_UPCOMING_DAYS,
} from "@/lib/constants";
import {
  STALE_GOALS_DAYS,
  STUCK_GOALS_LIMIT,
  RECENT_RUNS_HOURS,
  RECENT_RUNS_LIMIT,
} from "@/lib/constants/today";
import { ENTITY_TYPE } from "@/lib/constants/statuses";
import { BOOK_ACTION_TYPES } from "@/config/book";
import { db } from "@/db";
import {
  commitments,
  subscriptions,
  goals,
  alerts,
  actions,
  events,
  projectStates,
  orchestrationRuns,
  entities,
  promptHistory,
} from "@/db/schema";
import { eq, and, lt, lte, isNotNull, gte, desc, sql, notInArray } from "drizzle-orm";
import { HEALTH_FADING_DAYS } from "@/lib/constants/people";
import {
  GOAL_STATUS,
  SUB_STATUS,
  COMMITMENT_STATUS,
  ACTION_STATUS,
  ALERT_SEVERITY,
  EVENT_STATUS,
  HABIT_FREQUENCY,
} from "@/lib/constants/statuses";
import {
  READY_WINDOW_S,
  PROMPT_RUNNING_WINDOW_S,
  getHealthShort,
  isHealthPoor,
} from "@/lib/constants/control";
import { toPromptDisplayFields } from "@/lib/activity-status";
import { z } from "zod";
import { DAY_MS, HOUR_MS } from "@/lib/constants/time";

export const CreateCommitmentBody = z.object({
  description: z.string().trim().min(1, "description is required"),
  dueDate: z
    .string()
    .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid date")
    .optional(),
  financialImpact: z.string().trim().optional(),
});

export const PatchCommitmentBody = z.object({
  description: z.string().trim().min(1, "description cannot be empty").optional(),
  dueDate: z
    .string()
    .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid date")
    .nullable()
    .optional(),
  financialImpact: z.string().nullable().optional(),
});

export type CreateCommitmentInput = z.infer<typeof CreateCommitmentBody>;
type PatchCommitmentInput = z.infer<typeof PatchCommitmentBody>;

export async function createCommitment(
  userId: string,
  data: CreateCommitmentInput,
  source?: string,
) {
  const [created] = await db
    .insert(commitments)
    .values({
      userId,
      description: data.description,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      financialImpact: data.financialImpact || null,
      status: COMMITMENT_STATUS.ACTIVE,
      source: source ?? null,
    })
    .returning();
  return created;
}

export async function patchCommitment(userId: string, id: string, data: PatchCommitmentInput) {
  const patch: Partial<typeof commitments.$inferInsert> = { updatedAt: new Date() };
  if (data.description !== undefined) patch.description = data.description;
  if (data.dueDate !== undefined) patch.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.financialImpact !== undefined)
    patch.financialImpact = data.financialImpact?.trim() || null;
  const [updated] = await db
    .update(commitments)
    .set(patch)
    .where(and(eq(commitments.id, id), eq(commitments.userId, userId)))
    .returning();
  return updated ?? null;
}

export async function deleteCommitment(userId: string, id: string) {
  await db.delete(commitments).where(and(eq(commitments.id, id), eq(commitments.userId, userId)));
}

export async function fulfillCommitment(id: string, userId: string) {
  await db
    .update(commitments)
    .set({ status: COMMITMENT_STATUS.FULFILLED, updatedAt: new Date() })
    .where(and(eq(commitments.id, id), eq(commitments.userId, userId)));
}

/** Active commitments due on or before `now + days` (overdue included — those are
 *  the most urgent). Feeds dispatch context so agents are aware of the operator's
 *  time-sensitive obligations. Nearest deadline first; capped so a long list
 *  can't bloat the prompt.
 *
 *  Nearest deadline, not earliest date. Ordering by `due_date` ascending sounds
 *  like "most urgent first" and is the opposite once overdue rows are in scope:
 *  the oldest rows sort first and take the whole cap, so the two items that
 *  reached every dispatch on 2026-09-20 were a Coinbase bonus that expired
 *  2026-05-03 and a project-restore window that closed 2026-07-03, while
 *  anything actually due that fortnight never made the list (#584). A deadline
 *  two days past is urgent; one four months past is not, and neither is more
 *  urgent than tomorrow's. Distance from today is what "urgent" means here, so
 *  that is what the ORDER BY says.
 *
 *  Callers must render the overdue ones AS overdue — see isOverdue in
 *  lib/dates.ts, which shares this query's day boundary. */
export async function listUpcomingCommitments(userId: string, days = 14, limit = 8) {
  const until = new Date(Date.now() + days * DAY_MS);
  return db
    .select({ description: commitments.description, dueDate: commitments.dueDate })
    .from(commitments)
    .where(
      and(
        eq(commitments.userId, userId),
        eq(commitments.status, COMMITMENT_STATUS.ACTIVE),
        isNotNull(commitments.dueDate),
        lte(commitments.dueDate, until),
      ),
    )
    .orderBy(sql`abs(extract(epoch from (${commitments.dueDate} - now())))`)
    .limit(limit);
}

export async function getActiveCommitments(userId: string) {
  return db
    .select()
    .from(commitments)
    .where(and(eq(commitments.userId, userId), eq(commitments.status, COMMITMENT_STATUS.ACTIVE)))
    .orderBy(commitments.dueDate);
}

export async function getGoalsDueSoon(userId: string, days = GOALS_DUE_SOON_DAYS) {
  const soon = new Date();
  soon.setDate(soon.getDate() + days);

  return db
    .select({
      id: goals.id,
      title: goals.title,
      progress: goals.progress,
      targetDate: goals.targetDate,
    })
    .from(goals)
    .where(
      and(
        eq(goals.userId, userId),
        eq(goals.status, GOAL_STATUS.ACTIVE),
        isNotNull(goals.targetDate),
        lte(goals.targetDate, soon),
      ),
    )
    .orderBy(goals.targetDate);
}

export async function getUpcomingSubscriptions(userId: string, days = SUBSCRIPTIONS_UPCOMING_DAYS) {
  const future = new Date();
  future.setDate(future.getDate() + days);

  return db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, SUB_STATUS.ACTIVE),
        lte(subscriptions.nextDue, future),
      ),
    )
    .orderBy(subscriptions.nextDue);
}

export async function getTodaySummary(userId: string) {
  const goalsSoon = new Date();
  goalsSoon.setDate(goalsSoon.getDate() + GOALS_DUE_SOON_DAYS);

  const eventsSoon = new Date();
  eventsSoon.setDate(eventsSoon.getDate() + EVENTS_DUE_SOON_DAYS);

  const staleGoalsAt = new Date(Date.now() - STALE_GOALS_DAYS * DAY_MS);

  const [
    [goalStats],
    [alertStats],
    [urgentStats],
    [actionStats],
    [overdueStats],
    [goalsDueSoonStats],
    [eventsDueSoonStats],
    habitStatsResult,
    staleContactsResult,
    [stuckGoalStats],
  ] = await Promise.all([
    db
      .select({
        active: sql<number>`count(*)`,
        avgProgress: sql<number>`coalesce(avg(${goals.progress}), 0)`,
      })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.status, GOAL_STATUS.ACTIVE))),
    db
      .select({ total: sql<number>`count(*)` })
      .from(alerts)
      .where(and(eq(alerts.userId, userId), eq(alerts.dismissed, false))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(alerts)
      .where(
        and(
          eq(alerts.userId, userId),
          eq(alerts.dismissed, false),
          eq(alerts.severity, ALERT_SEVERITY.URGENT),
        ),
      ),
    db
      .select({ drafts: sql<number>`count(*)` })
      .from(actions)
      .where(
        and(
          eq(actions.userId, userId),
          eq(actions.status, ACTION_STATUS.DRAFT),
          notInArray(actions.type, [...BOOK_ACTION_TYPES]),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(commitments)
      .where(
        and(
          eq(commitments.userId, userId),
          eq(commitments.status, COMMITMENT_STATUS.ACTIVE),
          lte(commitments.dueDate, new Date()),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(goals)
      .where(
        and(
          eq(goals.userId, userId),
          eq(goals.status, GOAL_STATUS.ACTIVE),
          isNotNull(goals.targetDate),
          lte(goals.targetDate, goalsSoon),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          eq(events.status, EVENT_STATUS.ACTIVE),
          isNotNull(events.deadline),
          lte(events.deadline, eventsSoon),
        ),
      ),
    db.execute<{ total: string; done: string }>(sql`
      SELECT
        count(*)::text AS total,
        count(hc.id)::text AS done
      FROM habits h
      LEFT JOIN habit_completions hc
        ON hc.habit_id = h.id
        AND hc.completed_date = current_date
        AND hc.user_id = ${userId}
      WHERE h.user_id = ${userId}
        AND h.active = true
        AND (
          h.frequency = ${HABIT_FREQUENCY.DAILY}
          OR (h.frequency = ${HABIT_FREQUENCY.WEEKDAYS} AND EXTRACT(DOW FROM now()) BETWEEN 1 AND 5)
          OR (h.frequency = ${HABIT_FREQUENCY.WEEKLY}   AND EXTRACT(DOW FROM now()) = 1)
        )
    `),
    db.execute<{ count: string }>(sql`
      SELECT count(*)::text as count FROM (
        SELECT e.id
        FROM entities e
        JOIN interactions i ON i.entity_id = e.id AND i.user_id = ${userId}
        WHERE e.user_id = ${userId} AND e.type = ${ENTITY_TYPE.PERSON} AND (e.external_id IS NULL OR e.external_id != ${DEFAULT_USER_EXTERNAL_ID})
        GROUP BY e.id
        HAVING max(i.occurred_at) < now() - make_interval(days => ${HEALTH_FADING_DAYS})
      ) sub
    `),
    db
      .select({ count: sql<number>`count(*)` })
      .from(goals)
      .where(
        and(
          eq(goals.userId, userId),
          eq(goals.status, GOAL_STATUS.ACTIVE),
          eq(goals.progress, 0),
          lt(goals.updatedAt, staleGoalsAt),
        ),
      ),
  ]);

  const staleContacts = Number(
    (staleContactsResult[0] as { count: string } | undefined)?.count ?? 0,
  );
  const habitRow = habitStatsResult[0] as { total: string; done: string } | undefined;

  return {
    activeGoals: Number(goalStats.active),
    avgGoalProgress: Math.round(Number(goalStats.avgProgress)),
    activeAlerts: Number(alertStats.total),
    urgentAlerts: Number(urgentStats.count),
    pendingDrafts: Number(actionStats.drafts),
    overdueCommitments: Number(overdueStats.count),
    goalsDueSoon: Number(goalsDueSoonStats.count),
    eventsDueSoon: Number(eventsDueSoonStats.count),
    staleContacts,
    habitsTotal: Number(habitRow?.total ?? 0),
    habitsDone: Number(habitRow?.done ?? 0),
    stuckGoals: Number(stuckGoalStats.count),
  };
}

/** Counts agents with an active prompt (running) or recently finished (ready/waiting).
 *  Uses project_states DB only — no process scanning — so it's fast and safe for server components.
 *  Cutoffs are sourced from lib/constants/control so DB counts stay in sync with UI banner windows. */
export async function getFleetSummary(userId: string) {
  const cutoffRunning = new Date(Date.now() - PROMPT_RUNNING_WINDOW_S * 1000);
  const cutoffWaiting = new Date(Date.now() - READY_WINDOW_S * 1000);

  const rows = await db
    .select({
      currentPromptStartedAt: projectStates.currentPromptStartedAt,
      readyAt: projectStates.readyAt,
      sessionHealth: projectStates.sessionHealth,
    })
    .from(projectStates)
    .where(eq(projectStates.userId, userId));

  let running = 0;
  let waiting = 0;
  let degraded = 0;
  for (const r of rows) {
    if (r.currentPromptStartedAt && r.currentPromptStartedAt > cutoffRunning) {
      running++;
    } else if (r.readyAt && r.readyAt > cutoffWaiting) {
      waiting++;
    }
    if (r.sessionHealth) {
      const short = getHealthShort(r.sessionHealth);
      if (isHealthPoor(short)) degraded++;
    }
  }
  return { running, waiting, degraded };
}

export async function getStuckGoals(userId: string, days = STALE_GOALS_DAYS) {
  const cutoff = new Date(Date.now() - days * DAY_MS);
  return db
    .select({
      id: goals.id,
      title: goals.title,
      updatedAt: goals.updatedAt,
      entityName: entities.name,
    })
    .from(goals)
    .leftJoin(entities, eq(goals.entityId, entities.id))
    .where(
      and(
        eq(goals.userId, userId),
        eq(goals.status, GOAL_STATUS.ACTIVE),
        eq(goals.progress, 0),
        lt(goals.updatedAt, cutoff),
      ),
    )
    .orderBy(goals.updatedAt)
    .limit(STUCK_GOALS_LIMIT);
}

export async function getRecentOrchestrationRuns(
  userId: string,
  hours = RECENT_RUNS_HOURS,
  limit = RECENT_RUNS_LIMIT,
) {
  const since = new Date(Date.now() - hours * HOUR_MS);
  return db
    .select({
      id: orchestrationRuns.id,
      projectKey: orchestrationRuns.projectKey,
      state: orchestrationRuns.state,
      summary: orchestrationRuns.summary,
      finishedAt: orchestrationRuns.finishedAt,
      tokensIn: orchestrationRuns.tokensIn,
      tokensOut: orchestrationRuns.tokensOut,
      tokensCacheRead: orchestrationRuns.tokensCacheRead,
      costUsd: orchestrationRuns.costUsd,
    })
    .from(orchestrationRuns)
    .where(
      and(
        eq(orchestrationRuns.userId, userId),
        isNotNull(orchestrationRuns.finishedAt),
        gte(orchestrationRuns.finishedAt, since),
      ),
    )
    .orderBy(desc(orchestrationRuns.finishedAt))
    .limit(limit);
}

// Recent manual dispatches from /api/inject. Used as a fallback on Today's
// "Recent Agent Work" card when no orchestration runs have completed yet —
// without it, a fresh-install user (or one who dispatches via the prompt
// library / Send box) sees "No agent runs in the past 24 hours" even though
// they queued five injects today, which destroys trust in the dashboard.
export async function getRecentDispatches(
  userId: string,
  hours = RECENT_RUNS_HOURS,
  limit = RECENT_RUNS_LIMIT,
) {
  const since = new Date(Date.now() - hours * HOUR_MS);
  const rows = await db
    .select({
      id: promptHistory.id,
      projectKey: promptHistory.projectKey,
      adapter: promptHistory.adapter,
      intent: promptHistory.intent,
      customPrompt: promptHistory.customPrompt,
      resolvedPrompt: promptHistory.resolvedPrompt,
      dispatchedAt: promptHistory.dispatchedAt,
    })
    .from(promptHistory)
    .where(and(eq(promptHistory.userId, userId), gte(promptHistory.dispatchedAt, since)))
    .orderBy(desc(promptHistory.dispatchedAt))
    .limit(limit);
  // Route through the shared display mapper so the harness envelope is stripped
  // (SSOT with the Activity feed): a dispatch that is pure scaffolding — e.g. a
  // <task-notification> completion signal mis-recorded as a custom prompt —
  // surfaces its intent label instead of leaking the raw machine envelope.
  return rows.map((r) => ({
    id: r.id,
    projectKey: r.projectKey,
    adapter: r.adapter,
    intent: r.intent,
    customPrompt: toPromptDisplayFields(r).customPrompt,
    dispatchedAt: r.dispatchedAt,
  }));
}
