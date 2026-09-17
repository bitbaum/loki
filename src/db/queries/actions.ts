import { db } from "@/db";
import { actions } from "@/db/schema";
import type { ActionPayload, NewAction } from "@/db/schema/actions";
import {
  eq,
  and,
  desc,
  ne,
  sql,
  gt,
  lt,
  like,
  isNotNull,
  isNull,
  or,
  notInArray,
} from "drizzle-orm";
import { ACTION_STATUS, type ActionType } from "@/lib/constants/statuses";
import { BOOK_ACTION_TYPES } from "@/config/book";
import { CHECKIN_TITLE_PREFIX } from "@/lib/actions/checkin-proposal";

export type ActionRow = typeof actions.$inferSelect;

/** Input Loki (or any producer) supplies to enqueue a draft action.
 *  Mirrors the writable subset of NewAction; userId/status/timestamps are set here. */
export type ProposeActionInput = {
  type: ActionType;
  title: string;
  description?: string | null;
  payload?: ActionPayload | null;
  reasoning?: string | null;
  entityId?: string | null;
  expiresAt?: Date | null;
};

/**
 * Producer for the action queue — the ONLY way a draft enters.
 * Inserts with status='draft' (the IRON RULE start state). Dedupes against the
 * partial unique index idx_actions_unique_draft_title (userId, title WHERE status='draft'):
 * a re-proposal of an already-pending title is a no-op and returns null.
 */
export async function proposeAction(
  userId: string,
  input: ProposeActionInput,
): Promise<ActionRow | null> {
  const values: NewAction = {
    userId,
    type: input.type,
    status: ACTION_STATUS.DRAFT,
    title: input.title,
    description: input.description ?? null,
    payload: input.payload ?? null,
    reasoning: input.reasoning ?? null,
    entityId: input.entityId ?? null,
    expiresAt: input.expiresAt ?? null,
  };
  const [created] = await db.insert(actions).values(values).onConflictDoNothing().returning();
  return created ?? null;
}

/**
 * Mark an approved action as executed. Guarded by status='approved' so it can
 * only advance approved → executed (never resurrect a draft/rejected row, and
 * idempotent: a second call after execution matches nothing and returns null).
 */
export async function markActionExecuted(id: string, userId: string): Promise<ActionRow | null> {
  const [updated] = await db
    .update(actions)
    .set({ status: ACTION_STATUS.EXECUTED, executedAt: new Date() })
    .where(
      and(
        eq(actions.id, id),
        eq(actions.userId, userId),
        eq(actions.status, ACTION_STATUS.APPROVED),
      ),
    )
    .returning();
  return updated ?? null;
}

/** What a claiming drain needs to do the booking — nothing more. */
export type ClaimedAction = { id: string; title: string; payload: ActionPayload | null };

/**
 * CLAIM approved-but-unexecuted actions of a type, oldest first.
 *
 * The local runtime's calendar drain calls this (type=create_event) to find
 * events approved on the cloud control plane — where `gog` isn't present — so
 * it can book them locally.
 *
 * This must be a claim, not a read. `markActionExecuted` only fires AFTER the
 * booking succeeds, so between handing a row out and hearing back there is a
 * window in which the row still looks approved-and-unbooked to everybody. A
 * plain SELECT hands the same event to every caller in that window, and each
 * one books it — a duplicate entry in the operator's real calendar. One drain
 * runs today, but home/calendar-drain.ts's own usage line tells you to start
 * another, so the seam has to be safe for N of them by construction.
 *
 * Two mechanisms, doing different jobs:
 *   - FOR UPDATE SKIP LOCKED makes CONCURRENT claims disjoint. Two drains
 *     asking at the same instant get different rows instead of blocking or
 *     colliding.
 *   - `leaseMinutes` handles the drain that takes a row and then DIES. Its
 *     claim ages out and the row is offered again, so a crash costs a delay
 *     rather than an event that is never booked. Too short re-books a slow
 *     `gog` call; too long strands the work. Minutes, not seconds.
 *
 * `batchLimit` exists so a claim cannot outlive its own lease. The drain books
 * the batch one at a time, so claiming more rows than fit in `leaseMinutes`
 * would let the tail of the batch go stale while the drain is still working on
 * it — and a second drain would then legitimately claim rows the first is about
 * to book. Keep batchLimit × (booking time) comfortably under the lease.
 *
 * Idempotency still rests on markActionExecuted's status='approved' guard —
 * the claim narrows the race, it does not replace the guard.
 */
export async function claimApprovedActionsByType(
  userId: string,
  type: ActionType,
  leaseMinutes: number,
  batchLimit: number,
): Promise<ClaimedAction[]> {
  const result = await db.execute(sql`
    UPDATE ${actions} SET claimed_at = now()
    WHERE id IN (
      SELECT id FROM ${actions}
      WHERE user_id = ${userId}
        AND status = ${ACTION_STATUS.APPROVED}
        AND type = ${type}
        AND (claimed_at IS NULL OR claimed_at < now() - make_interval(mins => ${leaseMinutes}))
      ORDER BY created_at
      LIMIT ${batchLimit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, title, payload
  `);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return (rows as Array<{ id: string; title: string; payload: ActionPayload | null }>).map((r) => ({
    id: r.id,
    title: r.title,
    payload: r.payload ?? null,
  }));
}

/**
 * Hand a claimed row straight back, because the booking failed. The lease would
 * release it eventually anyway; releasing it now means a transient `gog` error
 * costs one poll interval instead of the whole lease. Scoped to still-approved
 * rows so it can never disturb one that has since executed.
 */
export async function releaseActionClaim(id: string, userId: string): Promise<void> {
  await db
    .update(actions)
    .set({ claimedAt: null })
    .where(
      and(
        eq(actions.id, id),
        eq(actions.userId, userId),
        eq(actions.status, ACTION_STATUS.APPROVED),
      ),
    );
}

/**
 * Retire drafts that can no longer be decided: past their own `expiresAt`, or
 * simply never answered within `maxAgeDays`.
 *
 * A proposal is time-bound. "Check in with Anja", proposed 121 days ago, is not
 * a decision the operator still owes an answer to — it is landfill, and keeping
 * it in the queue makes the queue itself untrustworthy (the 2026-08-06 prod
 * queue held 15 drafts, four of them calendar events whose dates had already
 * passed). Expired rows are kept, not deleted: the history of what Loki
 * proposed and what lapsed unanswered is worth more than the row is worth
 * costing.
 *
 * `reviewedAt` is stamped because expiry IS the closing decision — made by
 * policy rather than by a human — and without it these rows sort as NULLs
 * ahead of real reviews in getRecentActions.
 */
export async function expireDeadDrafts(maxAgeDays: number): Promise<ActionRow[]> {
  return db
    .update(actions)
    .set({ status: ACTION_STATUS.EXPIRED, reviewedAt: new Date() })
    .where(
      and(
        eq(actions.status, ACTION_STATUS.DRAFT),
        or(
          and(isNotNull(actions.expiresAt), lt(actions.expiresAt, sql`now()`)),
          lt(actions.createdAt, sql`now() - make_interval(days => ${maxAgeDays})`),
        ),
      ),
    )
    .returning();
}

/** Every pending draft of one type, oldest first — the set a payload-aware
 *  expiry rule has to inspect in TS because the answer lives in JSONB, not in
 *  a column. Bounded: an approval queue this long is itself the problem. */
export async function getDraftsByType(type: ActionType, limit = 500): Promise<ActionRow[]> {
  return db
    .select()
    .from(actions)
    .where(and(eq(actions.status, ACTION_STATUS.DRAFT), eq(actions.type, type)))
    .orderBy(actions.createdAt)
    .limit(limit);
}

/** Retire one draft. Guarded on status='draft' so it can never overwrite a
 *  decision the operator already made (idempotent: a second call returns null). */
export async function expireDraft(id: string): Promise<ActionRow | null> {
  const [updated] = await db
    .update(actions)
    .set({ status: ACTION_STATUS.EXPIRED, reviewedAt: new Date() })
    .where(and(eq(actions.id, id), eq(actions.status, ACTION_STATUS.DRAFT)))
    .returning();
  return updated ?? null;
}

/** One user's un-reviewed backlog: how many drafts are waiting and since when. */
export type StaleDraftSummary = {
  userId: string;
  pending: number;
  /**
   * The oldest waiting draft's id — so a reminder about ONE decision can carry
   * that decision (a one-tap approve link) instead of a link to a list with one
   * row in it. Comes from the same aggregate as the title, which is the point:
   * a second query could return a different row than the one being named.
   */
  oldestId: string;
  oldestTitle: string;
  oldestAgeSeconds: number;
};

/**
 * Drafts that have been waiting longer than `olderThanMinutes`, grouped by user.
 *
 * A draft is Loki asking a question, and until it is answered nothing happens —
 * so a draft nobody sees is a dropped ball, not a queued task. Observed
 * 2026-08-04: a calendar event sat unapproved for 6h47m while the operator,
 * unaware anything was pending, asked the assistant why it hadn't happened.
 * The reminder cron (api/crons/check-pending-approvals) reads this and raises
 * the flag so the queue announces itself instead of waiting to be discovered.
 *
 * Already-expired drafts are excluded — they are dead weight, not a pending
 * decision, and nagging about them would train the operator to ignore the alert.
 */
export async function getStaleDraftSummaries(
  olderThanMinutes: number,
): Promise<StaleDraftSummary[]> {
  const rows = await db
    .select({
      userId: actions.userId,
      pending: sql<number>`count(*)::int`,
      // Oldest-first ordering inside the aggregate, so [1] is the one that has
      // been waiting longest — the item worth naming in the alert.
      oldestId: sql<string>`(array_agg(${actions.id} order by ${actions.createdAt}))[1]`,
      oldestTitle: sql<string>`(array_agg(${actions.title} order by ${actions.createdAt}))[1]`,
      // Age computed in SQL: one clock (the database's), no driver timezone games.
      oldestAgeSeconds: sql<number>`extract(epoch from now() - min(${actions.createdAt}))::int`,
    })
    .from(actions)
    .where(
      and(
        eq(actions.status, ACTION_STATUS.DRAFT),
        notInArray(actions.type, [...BOOK_ACTION_TYPES]),
        lt(actions.createdAt, sql`now() - make_interval(mins => ${olderThanMinutes})`),
        or(isNull(actions.expiresAt), gt(actions.expiresAt, sql`now()`)),
      ),
    )
    .groupBy(actions.userId);

  return rows.map((r) => ({
    userId: r.userId,
    pending: Number(r.pending),
    oldestId: r.oldestId,
    oldestTitle: r.oldestTitle,
    oldestAgeSeconds: Number(r.oldestAgeSeconds),
  }));
}

export async function getActionById(userId: string, id: string): Promise<ActionRow | null> {
  const [row] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.id, id), eq(actions.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getPendingActions(userId: string) {
  return db
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.userId, userId),
        eq(actions.status, ACTION_STATUS.DRAFT),
        notInArray(actions.type, [...BOOK_ACTION_TYPES]),
      ),
    )
    .orderBy(desc(actions.createdAt));
}

export async function getRecentActions(userId: string, limit = 20) {
  return db
    .select()
    .from(actions)
    .where(and(eq(actions.userId, userId), ne(actions.status, ACTION_STATUS.DRAFT)))
    .orderBy(desc(actions.reviewedAt))
    .limit(limit);
}

export async function approveAction(id: string, userId: string) {
  return db
    .update(actions)
    .set({ status: ACTION_STATUS.APPROVED, reviewedAt: new Date() })
    .where(
      and(eq(actions.id, id), eq(actions.userId, userId), eq(actions.status, ACTION_STATUS.DRAFT)),
    )
    .returning();
}

/**
 * Rewrite a draft's payload before approving it — used by the advisor's
 * "dispatch trimmed" path, which strips non-report submissions out of the
 * composed prompt. Restricted to drafts on purpose: the payload of an action
 * that already ran is the record of what ran, and must stay immutable.
 */
export async function updateDraftPayload(id: string, userId: string, payload: ActionPayload) {
  const [row] = await db
    .update(actions)
    .set({ payload })
    .where(
      and(eq(actions.id, id), eq(actions.userId, userId), eq(actions.status, ACTION_STATUS.DRAFT)),
    )
    .returning();
  return row ?? null;
}

export async function rejectAction(id: string, userId: string) {
  return db
    .update(actions)
    .set({ status: ACTION_STATUS.REJECTED, reviewedAt: new Date() })
    .where(
      and(eq(actions.id, id), eq(actions.userId, userId), eq(actions.status, ACTION_STATUS.DRAFT)),
    )
    .returning();
}

// ── Proactive check-in producer support (see lib/actions/checkin-producer.ts) ──

/**
 * Count pending (draft) check-in proposals for a user. Queue-pressure guard so
 * the proactive producer never floods the approval queue with un-actioned nudges.
 */
export async function countPendingCheckins(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(actions)
    .where(
      and(
        eq(actions.userId, userId),
        eq(actions.status, ACTION_STATUS.DRAFT),
        like(actions.title, `${CHECKIN_TITLE_PREFIX}%`),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Entity ids that already had a check-in proposed within `sinceDays` (ANY
 * status). The per-contact cooldown: a rejected or executed nudge shouldn't be
 * re-proposed the next tick — only after the window lapses. Complements the
 * still-pending dedupe already enforced by proposeAction's unique-draft index.
 */
export async function getEntityIdsWithRecentCheckin(
  userId: string,
  sinceDays: number,
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ entityId: actions.entityId })
    .from(actions)
    .where(
      and(
        eq(actions.userId, userId),
        isNotNull(actions.entityId),
        like(actions.title, `${CHECKIN_TITLE_PREFIX}%`),
        gt(actions.createdAt, sql`now() - make_interval(days => ${sinceDays})`),
      ),
    );
  return new Set(rows.map((r) => r.entityId).filter((id): id is string => id !== null));
}
