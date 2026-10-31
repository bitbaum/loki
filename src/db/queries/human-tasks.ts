/**
 * Assignments handed to humans — reads and writes.
 *
 * Two callers with very different rights share this file, and the split is
 * enforced here rather than in the routes so both paths cannot drift:
 *
 *   operator (session, private zone)  → everything, but only OPERATOR_MOVES.
 *   assignee (a share token, no account) → one task, and only ASSIGNEE_MOVES.
 *
 * The token IS the assignee's credential, so every token-side function looks a
 * task up BY token and never takes an id — there is no shape of call that lets
 * a link for one assignment answer another. And a revoked or missing token
 * resolves to nothing at all, which is what makes "un-send" real.
 */

import { randomBytes } from "node:crypto";
import { aliasedTable, and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attributes,
  entities,
  humanTaskEvents,
  humanTasks,
  users,
  type HumanTask,
} from "@/db/schema";
import { ENTITY_TYPE, HUMAN_TASK_STATUS, type HumanTaskStatus } from "@/lib/constants/statuses";
import {
  ASSIGNEE_ACTION_STATUS,
  CLOSED_HUMAN_TASK_STATUSES,
  CREW_ATTR,
  TASK_ACTOR,
  TASK_EVENT,
  assigneeActionsFor,
  canOperatorMove,
  canShare,
  taskSharePath,
  type CreateHumanTaskInput,
  type PatchHumanTaskInput,
  type RespondToTaskInput,
  type TaskActor,
  type TaskEventKind,
} from "@/config/crew";
import { assertAssignablePerson } from "@/db/queries/crew";
import { changesCrewConsentTerms } from "@/lib/crew/consent-terms";

const assignee = aliasedTable(entities, "assignee");
const project = aliasedTable(entities, "project");
/** The assignee's OrangeCat profile — where the fee is actually paid. */
const payTo = aliasedTable(attributes, "assignee_pay");

export type HumanTaskRow = HumanTask & {
  assigneeName: string | null;
  projectName: string | null;
  /**
   * The assignee's OrangeCat profile, carried on the task so both sides can see
   * where the money goes. Null means the fee has no destination yet — worth
   * saying out loud on a paid assignment, because "accepted, no way to pay you"
   * is a promise the board would otherwise render as complete.
   */
  assigneePayUrl: string | null;
  /** Path to the live share link, or null when nothing is currently shared. */
  sharePath: string | null;
};

export type HumanTaskTimelineEntry = {
  id: string;
  kind: TaskEventKind;
  actor: TaskActor;
  status: HumanTaskStatus | null;
  note: string | null;
  createdAt: Date;
};

export type HumanTaskDetail = HumanTaskRow & { timeline: HumanTaskTimelineEntry[] };

/** What the person who was asked sees. Nothing from the operator's book leaks in. */
export type SharedTask = {
  id: string;
  title: string;
  brief: string | null;
  reason: string | null;
  status: HumanTaskStatus;
  dueDate: Date | null;
  feeAmount: number | null;
  feeCurrency: string | null;
  orangecatUrl: string | null;
  /** Their own OrangeCat profile — the wallet this fee is headed for. */
  payToUrl: string | null;
  fromName: string;
  assigneeName: string | null;
  projectName: string | null;
  assignedAt: Date | null;
  actions: ReturnType<typeof assigneeActionsFor>;
  timeline: HumanTaskTimelineEntry[];
};

function withDerived(row: {
  task: HumanTask;
  assigneeName: string | null;
  projectName: string | null;
  assigneePayUrl: string | null;
}): HumanTaskRow {
  const live = row.task.shareToken && !row.task.revokedAt ? row.task.shareToken : null;
  return {
    ...row.task,
    assigneeName: row.assigneeName,
    projectName: row.projectName,
    assigneePayUrl: row.assigneePayUrl,
    sharePath: live ? taskSharePath(live) : null,
  };
}

const SELECT_TASK = {
  task: humanTasks,
  assigneeName: assignee.name,
  // The project's title when it has one: its name is a folder slug
  // ("camille-boulangerie"), and this reaches the assignee's own page too.
  projectName: sql<string | null>`coalesce(${project.title}, ${project.name})`,
  assigneePayUrl: payTo.value,
};

function taskQuery() {
  return db
    .select(SELECT_TASK)
    .from(humanTasks)
    .leftJoin(assignee, eq(assignee.id, humanTasks.assigneeId))
    .leftJoin(project, eq(project.id, humanTasks.projectId))
    .leftJoin(
      payTo,
      and(
        eq(payTo.entityId, humanTasks.assigneeId),
        eq(payTo.userId, humanTasks.userId),
        eq(payTo.key, CREW_ATTR.ORANGECAT_PROFILE),
      ),
    );
}

export async function listHumanTasks(
  userId: string,
  filter: { status?: HumanTaskStatus[]; assigneeId?: string; projectId?: string } = {},
): Promise<HumanTaskRow[]> {
  const clauses = [eq(humanTasks.userId, userId)];
  if (filter.status?.length) clauses.push(inArray(humanTasks.status, filter.status));
  if (filter.assigneeId) clauses.push(eq(humanTasks.assigneeId, filter.assigneeId));
  if (filter.projectId) clauses.push(eq(humanTasks.projectId, filter.projectId));

  const rows = await taskQuery()
    .where(and(...clauses))
    .orderBy(desc(humanTasks.updatedAt))
    .limit(200);
  return rows.map(withDerived);
}

export async function getHumanTask(userId: string, id: string): Promise<HumanTaskDetail | null> {
  const [row] = await taskQuery()
    .where(and(eq(humanTasks.id, id), eq(humanTasks.userId, userId)))
    .limit(1);
  if (!row) return null;
  return { ...withDerived(row), timeline: await getTimeline(id) };
}

async function getTimeline(taskId: string): Promise<HumanTaskTimelineEntry[]> {
  const rows = await db
    .select({
      id: humanTaskEvents.id,
      kind: humanTaskEvents.kind,
      actor: humanTaskEvents.actor,
      status: humanTaskEvents.status,
      note: humanTaskEvents.note,
      createdAt: humanTaskEvents.createdAt,
    })
    .from(humanTaskEvents)
    .where(eq(humanTaskEvents.taskId, taskId))
    .orderBy(humanTaskEvents.createdAt)
    .limit(100);
  return rows;
}

async function recordEvent(
  userId: string,
  taskId: string,
  kind: TaskEventKind,
  actor: TaskActor,
  extra: { status?: HumanTaskStatus; note?: string | null } = {},
): Promise<void> {
  await db.insert(humanTaskEvents).values({
    taskId,
    userId,
    kind,
    actor,
    status: extra.status ?? null,
    note: extra.note?.trim() || null,
  });
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A project id must be one of the operator's own projects, or it is dropped. */
async function resolveProjectId(
  userId: string,
  projectId: string | null | undefined,
): Promise<string | null> {
  if (!projectId) return null;
  const [row] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.id, projectId),
        eq(entities.userId, userId),
        eq(entities.type, ENTITY_TYPE.PROJECT),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Write a new assignment. It starts as a DRAFT and tells nobody anything —
 * that is what makes it safe for Loki to propose one (see tools/handlers.ts).
 * `actor` records who wrote it so the timeline can say "Loki drafted this".
 */
export async function createHumanTask(
  userId: string,
  input: CreateHumanTaskInput,
  actor: TaskActor = TASK_ACTOR.OPERATOR,
): Promise<HumanTaskRow | null> {
  const assigneeId = input.assigneeId
    ? ((await assertAssignablePerson(userId, input.assigneeId))?.id ?? null)
    : null;

  const [created] = await db
    .insert(humanTasks)
    .values({
      userId,
      assigneeId,
      projectId: await resolveProjectId(userId, input.projectId),
      title: input.title.trim(),
      brief: input.brief?.trim() || null,
      reason: input.reason?.trim() || null,
      dueDate: parseDate(input.dueDate),
      feeAmount: input.feeAmount ?? null,
      feeCurrency: input.feeAmount !== undefined ? (input.feeCurrency ?? null) : null,
      status: HUMAN_TASK_STATUS.DRAFT,
    })
    .returning();
  if (!created) return null;

  await recordEvent(userId, created.id, TASK_EVENT.CREATED, actor, {
    status: HUMAN_TASK_STATUS.DRAFT,
  });
  return (await getHumanTask(userId, created.id)) ?? null;
}

export class TaskTransitionError extends Error {
  readonly status = 409;
  constructor(from: HumanTaskStatus, to: HumanTaskStatus) {
    super(`An assignment cannot go from ${from} to ${to}.`);
    this.name = "TaskTransitionError";
  }
}

export function isTaskTransitionError(e: unknown): e is TaskTransitionError {
  return e instanceof TaskTransitionError;
}

/**
 * Operator-side edit. Status changes are checked against OPERATOR_MOVES, so
 * the one thing this can never do is record the assignee's consent for them.
 */
export async function patchHumanTask(
  userId: string,
  id: string,
  input: PatchHumanTaskInput,
): Promise<HumanTaskDetail | null> {
  // Resolve foreign keys before acquiring the row lock. The transaction is
  // responsible for judging consent against the *current*, locked assignment.
  const assigneeId =
    input.assigneeId === undefined
      ? undefined
      : input.assigneeId
        ? ((await assertAssignablePerson(userId, input.assigneeId))?.id ?? null)
        : null;
  const projectId =
    input.projectId === undefined ? undefined : await resolveProjectId(userId, input.projectId);

  const changed = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(humanTasks)
      .where(and(eq(humanTasks.id, id), eq(humanTasks.userId, userId)))
      .limit(1)
      .for("update");
    if (!existing) return false;

    const now = new Date();
    const patch: Partial<typeof humanTasks.$inferInsert> = { updatedAt: now };
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.brief !== undefined) patch.brief = input.brief?.trim() || null;
    if (input.reason !== undefined) patch.reason = input.reason?.trim() || null;
    if (input.dueDate !== undefined) patch.dueDate = parseDate(input.dueDate);
    if (input.feeAmount !== undefined) patch.feeAmount = input.feeAmount;
    if (input.feeCurrency !== undefined) patch.feeCurrency = input.feeCurrency;
    if (projectId !== undefined) patch.projectId = projectId;
    if (assigneeId !== undefined) patch.assigneeId = assigneeId;

    const termsChanged = changesCrewConsentTerms(existing, patch);
    if (termsChanged && CLOSED_HUMAN_TASK_STATUSES.includes(existing.status)) {
      throw new TaskShareError("Reopen this assignment before changing its terms.");
    }
    if (termsChanged && input.status && input.status !== HUMAN_TASK_STATUS.DRAFT) {
      throw new TaskShareError(
        "Changing the assignment requires a fresh handover; edit it first, then share it.",
      );
    }

    const nextStatus = termsChanged ? HUMAN_TASK_STATUS.DRAFT : input.status;
    if (termsChanged) {
      // A changed ask has NO current assignee consent. Its previous share link
      // is dead even if an old ACCEPTED event remains in the audit timeline.
      patch.status = HUMAN_TASK_STATUS.DRAFT;
      patch.revokedAt = now;
      patch.assignedAt = null;
      patch.respondedAt = null;
      patch.deliveredAt = null;
      patch.completedAt = null;
      patch.viewedAt = null;
    } else if (nextStatus && nextStatus !== existing.status) {
      if (!canOperatorMove(existing.status, nextStatus)) {
        throw new TaskTransitionError(existing.status, nextStatus);
      }
      patch.status = nextStatus;
      if (nextStatus === HUMAN_TASK_STATUS.DONE) patch.completedAt = now;
      if (nextStatus === HUMAN_TASK_STATUS.DRAFT) {
        patch.revokedAt = now;
        patch.assignedAt = null;
      }
    }

    await tx
      .update(humanTasks)
      .set(patch)
      .where(and(eq(humanTasks.id, id), eq(humanTasks.userId, userId)));

    const statusChanged = nextStatus && nextStatus !== existing.status;
    await tx.insert(humanTaskEvents).values({
      taskId: id,
      userId,
      kind:
        termsChanged || statusChanged
          ? TASK_EVENT.STATUS
          : input.note
            ? TASK_EVENT.NOTE
            : TASK_EVENT.EDITED,
      actor: TASK_ACTOR.OPERATOR,
      status: termsChanged ? HUMAN_TASK_STATUS.DRAFT : statusChanged ? nextStatus : null,
      note:
        input.note?.trim() || (termsChanged ? "Terms changed — fresh acceptance required." : null),
    });
    return true;
  });

  return changed ? getHumanTask(userId, id) : null;
}

export async function deleteHumanTask(userId: string, id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(humanTasks)
    .where(and(eq(humanTasks.id, id), eq(humanTasks.userId, userId)))
    .returning({ id: humanTasks.id });
  return Boolean(deleted);
}

export class TaskShareError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "TaskShareError";
  }
}

export function isTaskShareError(e: unknown): e is TaskShareError {
  return e instanceof TaskShareError;
}

/**
 * Hand the assignment over: mint a link and move the row to `assigned`.
 *
 * This is the ONE act that reaches a human, which is why it is a separate
 * function with its own guard rather than a status the patch route can set.
 * A task with nobody assigned has no one to hand it to, and a closed one has
 * nothing left to ask — `canShare` says so once, for every caller.
 */
export async function shareHumanTask(userId: string, id: string): Promise<HumanTaskDetail | null> {
  const shared = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(humanTasks)
      .where(and(eq(humanTasks.id, id), eq(humanTasks.userId, userId)))
      .limit(1)
      .for("update");
    if (!existing) return false;
    if (!canShare(existing)) {
      throw new TaskShareError(
        existing.assigneeId
          ? "This assignment is closed — reopen it before sharing."
          : "Assign this to someone before you hand it over.",
      );
    }

    const now = new Date();
    const reuseLive = existing.shareToken && !existing.revokedAt;
    const patch: Partial<typeof humanTasks.$inferInsert> = {
      shareToken: reuseLive ? existing.shareToken : randomBytes(24).toString("base64url"),
      sharedAt: now,
      revokedAt: null,
      updatedAt: now,
    };
    if (existing.status === HUMAN_TASK_STATUS.DRAFT) {
      patch.status = HUMAN_TASK_STATUS.ASSIGNED;
      patch.assignedAt = now;
    }

    await tx
      .update(humanTasks)
      .set(patch)
      .where(and(eq(humanTasks.id, id), eq(humanTasks.userId, userId)));
    await tx.insert(humanTaskEvents).values({
      taskId: id,
      userId,
      kind: TASK_EVENT.SHARED,
      actor: TASK_ACTOR.OPERATOR,
      status: patch.status ?? null,
    });
    return true;
  });
  return shared ? getHumanTask(userId, id) : null;
}

/**
 * Kill the share link while holding the same lock used by the responder and
 * editor. A response cannot slip in after the link was revoked.
 */
export async function revokeHumanTaskShare(
  userId: string,
  id: string,
): Promise<HumanTaskDetail | null> {
  const revoked = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(humanTasks)
      .where(and(eq(humanTasks.id, id), eq(humanTasks.userId, userId)))
      .limit(1)
      .for("update");
    if (!existing) return false;

    const now = new Date();
    const patch: Partial<typeof humanTasks.$inferInsert> = { revokedAt: now, updatedAt: now };
    if (existing.status === HUMAN_TASK_STATUS.ASSIGNED) {
      patch.status = HUMAN_TASK_STATUS.DRAFT;
      patch.assignedAt = null;
    }

    await tx
      .update(humanTasks)
      .set(patch)
      .where(and(eq(humanTasks.id, id), eq(humanTasks.userId, userId)));
    await tx.insert(humanTaskEvents).values({
      taskId: id,
      userId,
      kind: TASK_EVENT.REVOKED,
      actor: TASK_ACTOR.OPERATOR,
      status: patch.status ?? null,
    });
    return true;
  });
  return revoked ? getHumanTask(userId, id) : null;
}

/** Store the OrangeCat mirror pointer. See lib/integrations/orangecat-human-task.ts. */
export async function linkTaskToOrangeCat(
  userId: string,
  id: string,
  link: { serviceId: string; url: string | null },
): Promise<void> {
  await db
    .update(humanTasks)
    .set({ orangecatServiceId: link.serviceId, orangecatUrl: link.url, updatedAt: new Date() })
    .where(and(eq(humanTasks.id, id), eq(humanTasks.userId, userId)));
  await recordEvent(userId, id, TASK_EVENT.PUBLISHED, TASK_ACTOR.OPERATOR, { note: link.url });
}

// ─── Token side — the assignee, who has no account ───────────────────────────

async function findByToken(token: string) {
  const [row] = await taskQuery()
    .where(and(eq(humanTasks.shareToken, token), isNull(humanTasks.revokedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * The assignment as its assignee sees it.
 *
 * `fromName` is the operator's display name — they are being asked by a person,
 * not by software. Everything else on the row that is none of the assignee's
 * business (other tasks, the operator's private notes, the roster) is simply
 * not in this shape.
 */
export async function getSharedTask(token: string): Promise<SharedTask | null> {
  const row = await findByToken(token);
  if (!row) return null;

  const [owner] = await db
    .select({ name: users.name, username: users.username })
    .from(users)
    .where(eq(users.id, row.task.userId))
    .limit(1);

  const timeline = (await getTimeline(row.task.id)).filter(
    // The operator's internal notes stay internal; hand-offs and the
    // assignee's own answers are exactly what they should be able to re-read.
    (e) =>
      e.actor === TASK_ACTOR.ASSIGNEE ||
      e.kind === TASK_EVENT.SHARED ||
      e.kind === TASK_EVENT.STATUS,
  );

  return {
    id: row.task.id,
    title: row.task.title,
    brief: row.task.brief,
    reason: row.task.reason,
    status: row.task.status,
    dueDate: row.task.dueDate,
    feeAmount: row.task.feeAmount,
    feeCurrency: row.task.feeCurrency,
    orangecatUrl: row.task.orangecatUrl,
    payToUrl: row.assigneePayUrl,
    fromName: owner?.name || owner?.username || "Loki",
    assigneeName: row.assigneeName,
    projectName: row.projectName,
    assignedAt: row.task.assignedAt,
    actions: assigneeActionsFor(row.task.status),
    timeline,
  };
}

/** First open of the link. Best-effort — never blocks the page render. */
export async function markSharedTaskViewed(token: string): Promise<void> {
  await db
    .update(humanTasks)
    .set({ viewedAt: sql`coalesce(${humanTasks.viewedAt}, now())` })
    .where(and(eq(humanTasks.shareToken, token), isNull(humanTasks.revokedAt)));
}

/**
 * The assignee's answer — the only write anyone without an account can make.
 *
 * Their action is mapped to a status through ASSIGNEE_ACTION_STATUS and checked
 * against ASSIGNEE_MOVES, so a replayed or hand-edited request cannot move a
 * task somewhere the person was never offered.
 */
export async function respondToSharedTask(
  token: string,
  input: RespondToTaskInput,
): Promise<SharedTask | null> {
  const answered = await db.transaction(async (tx) => {
    // Lock by the bearer credential itself. A previously valid link must
    // never update a different assignee's newly revised assignment.
    const [existing] = await tx
      .select()
      .from(humanTasks)
      .where(and(eq(humanTasks.shareToken, token), isNull(humanTasks.revokedAt)))
      .limit(1)
      .for("update");
    if (!existing || !existing.assigneeId) return false;

    const nextStatus = ASSIGNEE_ACTION_STATUS[input.action];
    if (!assigneeActionsFor(existing.status).includes(input.action)) {
      throw new TaskTransitionError(existing.status, nextStatus);
    }

    const now = new Date();
    const patch: Partial<typeof humanTasks.$inferInsert> = {
      status: nextStatus,
      respondedAt: now,
      updatedAt: now,
    };
    if (nextStatus === HUMAN_TASK_STATUS.DELIVERED) patch.deliveredAt = now;

    await tx
      .update(humanTasks)
      .set(patch)
      .where(
        and(
          eq(humanTasks.id, existing.id),
          eq(humanTasks.shareToken, token),
          isNull(humanTasks.revokedAt),
        ),
      );
    await tx.insert(humanTaskEvents).values({
      taskId: existing.id,
      userId: existing.userId,
      kind: TASK_EVENT.STATUS,
      actor: TASK_ACTOR.ASSIGNEE,
      status: nextStatus,
      note: input.note?.trim() || null,
    });
    return true;
  });
  // The link could have been revoked immediately afterward, in which case
  // the read hides it instead of returning an obsolete permission.
  return answered ? getSharedTask(token) : null;
}

/** Everything still open, newest first — Loki's read of "who owes me what". */
export async function listOpenHumanTasks(userId: string, limit = 20): Promise<HumanTaskRow[]> {
  const rows = await taskQuery()
    .where(
      and(
        eq(humanTasks.userId, userId),
        sql`${humanTasks.status} NOT IN (${sql.join(
          CLOSED_HUMAN_TASK_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      ),
    )
    .orderBy(desc(humanTasks.updatedAt))
    .limit(limit);
  return rows.map(withDerived);
}
