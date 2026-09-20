import { and, count, desc, eq, getTableColumns, inArray, max, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  entities,
  siteFeedback,
  userProjects,
  projectMemberships,
  type SiteFeedback,
  type NewSiteFeedback,
} from "@/db/schema";
import { FEEDBACK_STATUS, type FeedbackStatus } from "@/lib/constants/statuses";
import { getProjectAccess } from "@/db/queries/project-access";

export async function insertSiteFeedback(values: NewSiteFeedback): Promise<SiteFeedback | null> {
  const [created] = await db.insert(siteFeedback).values(values).returning();
  return created ?? null;
}

/** Link exactly one signed claim to the signed-in reporter. A claim already
 * owned by another account cannot be stolen by replaying its URL. */
export async function claimFeedbackForReporter(
  feedbackId: string,
  reporterUserId: string,
): Promise<"claimed" | "already-claimed" | "missing"> {
  const [claimed] = await db
    .update(siteFeedback)
    .set({ reporterUserId })
    .where(and(eq(siteFeedback.id, feedbackId), sql`${siteFeedback.reporterUserId} IS NULL`))
    .returning({ id: siteFeedback.id });
  if (claimed) return "claimed";
  const [existing] = await db
    .select({ reporterUserId: siteFeedback.reporterUserId })
    .from(siteFeedback)
    .where(eq(siteFeedback.id, feedbackId))
    .limit(1);
  if (!existing) return "missing";
  return existing.reporterUserId === reporterUserId ? "claimed" : "already-claimed";
}

export async function listReporterFeedback(
  reporterUserId: string,
  limit = 200,
): Promise<UserFeedbackListItem[]> {
  const { screenshots: _screenshots, ...cols } = getTableColumns(siteFeedback);
  return db
    .select({
      ...cols,
      hasScreenshots: sql<boolean>`false`.as("has_screenshots"),
      projectName: entities.name,
      // The project's public origin, so the reporter can be sent to look at
      // the page they reported once a fix ships. Stubbed `null` until now,
      // which silently disabled "Check the live page" on the one surface whose
      // reader is the person best placed to confirm the fix.
      liveUrl: sql<string | null>`(
        SELECT ${userProjects.liveUrl} FROM ${userProjects}
        WHERE ${userProjects.entityProjectId} = ${entities.id}
          AND ${userProjects.userId} = ${siteFeedback.userId}
          AND ${userProjects.isActive} = true
        ORDER BY ${userProjects.createdAt} ASC LIMIT 1
      )`.as("live_url"),
      // Whether an agent COULD be launched is the owner's question, never the
      // reporter's — no button on this page dispatches anything.
      runnable: sql<boolean>`false`.as("runnable"),
    })
    .from(siteFeedback)
    .innerJoin(entities, eq(siteFeedback.projectId, entities.id))
    .where(eq(siteFeedback.reporterUserId, reporterUserId))
    .orderBy(desc(siteFeedback.createdAt))
    .limit(limit);
}

/**
 * Ingest dedupe: if an OPEN row (new/dispatched — not resolved, not archived)
 * with the same content hash exists for the project, bump its duplicate_count
 * and return its id; the caller then skips the insert. A complaint re-filed
 * AFTER its fix resolved the row is a fresh report (maybe a regression) and
 * gets a new row.
 */
export async function bumpDuplicateFeedback(
  projectId: string,
  contentHash: string,
): Promise<string | null> {
  const [bumped] = await db
    .update(siteFeedback)
    .set({ duplicateCount: sql`${siteFeedback.duplicateCount} + 1` })
    .where(
      and(
        eq(siteFeedback.projectId, projectId),
        eq(siteFeedback.contentHash, contentHash),
        inArray(siteFeedback.status, [FEEDBACK_STATUS.NEW, FEEDBACK_STATUS.DISPATCHED]),
      ),
    )
    .returning({ id: siteFeedback.id });
  return bumped?.id ?? null;
}

/** Inbox row: everything except the screenshot bytes (kept out of list
 *  payloads), plus a flag so the UI can offer the images on demand. */
export type FeedbackListItem = Omit<SiteFeedback, "screenshots"> & {
  hasScreenshots: boolean;
  /** The project's public URL (user_projects.live_url) — where "Check live"
   *  opens, with the reported path. The reported host is only a fallback. */
  liveUrl: string | null;
  /** The project has somewhere for an agent to work (a folder or a
   *  repository). False = Implement would launch an agent into nothing, so the
   *  row says so instead of letting the run fail later. */
  runnable: boolean;
};

/** Inbox for one project, newest first. Owner-scoped by userId. */
export async function listProjectFeedback(
  userId: string,
  projectId: string,
  limit = 200,
): Promise<FeedbackListItem[]> {
  return db.query.siteFeedback.findMany({
    where: and(eq(siteFeedback.userId, userId), eq(siteFeedback.projectId, projectId)),
    orderBy: [desc(siteFeedback.createdAt)],
    limit,
    columns: { screenshots: false },
    extras: {
      hasScreenshots:
        sql<boolean>`(${siteFeedback.screenshots} IS NOT NULL AND jsonb_array_length(${siteFeedback.screenshots}) > 0)`.as(
          "has_screenshots",
        ),
      liveUrl: sql<string | null>`(
        SELECT ${userProjects.liveUrl} FROM ${userProjects}
        WHERE ${userProjects.entityProjectId} = ${siteFeedback.projectId}
          AND ${userProjects.userId} = ${siteFeedback.userId}
          AND ${userProjects.isActive} = true
        ORDER BY ${userProjects.createdAt} ASC LIMIT 1
      )`.as("live_url"),
      // Same flag the cross-project inbox carries. Without it this surface
      // offered Implement on a project with nowhere for an agent to work and
      // the operator got a 422 toast instead of the sentence telling them to
      // connect a repository — the same row behaving differently in two places.
      runnable: sql<boolean>`EXISTS (
        SELECT 1 FROM ${userProjects}
        WHERE ${userProjects.entityProjectId} = ${siteFeedback.projectId}
          AND ${userProjects.userId} = ${siteFeedback.userId}
          AND ${userProjects.isActive} = true
          AND (${userProjects.dirPath} IS NOT NULL OR ${userProjects.gitUrl} IS NOT NULL)
      )`.as("runnable"),
    },
  });
}

/**
 * The feedback loop in numbers: how much lands, how much ships, and how fast
 * report becomes fix. Median (not avg) via percentile_cont so one slow outlier
 * can't wreck the story. On-demand aggregate — no metrics infrastructure.
 */
export type FeedbackLoopMetrics = {
  total: number;
  open: number;
  resolved: number;
  resolved30d: number;
  /**
   * Reports that were filed away rather than fixed.
   *
   * Counted because without it the page does not add up. `open` is new +
   * dispatched and `resolved` is shipped, so a reader who subtracts is left
   * holding a remainder with no name: prod on 2026-09-20 showed "68 reports ·
   * 29 still open" beside "32 shipped", and 29 + 32 is 61. The missing seven
   * were archived, and nothing on screen said the state existed.
   */
  archived: number;
  medianResolutionHours: number | null;
};

export async function getFeedbackLoopMetrics(
  userId: string,
  projectId?: string,
): Promise<FeedbackLoopMetrics> {
  const where = projectId
    ? and(eq(siteFeedback.userId, userId), eq(siteFeedback.projectId, projectId))
    : eq(siteFeedback.userId, userId);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${siteFeedback.status} in (${FEEDBACK_STATUS.NEW}, ${FEEDBACK_STATUS.DISPATCHED}))::int`,
      resolved: sql<number>`count(*) filter (where ${siteFeedback.status} = ${FEEDBACK_STATUS.RESOLVED})::int`,
      resolved30d: sql<number>`count(*) filter (where ${siteFeedback.status} = ${FEEDBACK_STATUS.RESOLVED} and ${siteFeedback.resolvedAt} > now() - interval '30 days')::int`,
      archived: sql<number>`count(*) filter (where ${siteFeedback.status} = ${FEEDBACK_STATUS.ARCHIVED})::int`,
      medianResolutionHours: sql<
        number | null
      >`extract(epoch from percentile_cont(0.5) within group (order by (${siteFeedback.resolvedAt} - ${siteFeedback.createdAt})) filter (where ${siteFeedback.resolvedAt} is not null)) / 3600`,
    })
    .from(siteFeedback)
    .where(where);
  return {
    total: row?.total ?? 0,
    open: row?.open ?? 0,
    resolved: row?.resolved ?? 0,
    resolved30d: row?.resolved30d ?? 0,
    archived: row?.archived ?? 0,
    medianResolutionHours:
      row?.medianResolutionHours != null ? Number(row.medianResolutionHours) : null,
  };
}

/** Operator curation toggle for the public strip — resolved rows only. */
export async function setFeedbackFeatured(
  userId: string,
  id: string,
  featured: boolean,
): Promise<boolean> {
  const [updated] = await db
    .update(siteFeedback)
    .set({ featuredAt: featured ? new Date() : null })
    .where(
      and(
        eq(siteFeedback.id, id),
        eq(siteFeedback.userId, userId),
        eq(siteFeedback.status, FEEDBACK_STATUS.RESOLVED),
      ),
    )
    .returning({ id: siteFeedback.id });
  return !!updated;
}

/** The screenshot bytes for one row (owner-scoped) — the ONLY reader of the
 *  screenshots column. */
export async function getFeedbackScreenshots(userId: string, id: string): Promise<string[] | null> {
  const [row] = await db
    .select({ screenshots: siteFeedback.screenshots })
    .from(siteFeedback)
    .where(and(eq(siteFeedback.id, id), eq(siteFeedback.userId, userId)))
    .limit(1);
  return row?.screenshots ?? null;
}

/** Cross-project inbox row: the list shape plus which project it belongs to. */
export type UserFeedbackListItem = FeedbackListItem & { projectName: string };

/**
 * Every project's inbox in one read — the lens behind /feedback. Same
 * screenshots exclusion as the per-project list; the join supplies the project
 * name so the UI never needs a second lookup. Newest first across the fleet.
 */
export async function listUserFeedback(
  userId: string,
  limit = 400,
): Promise<UserFeedbackListItem[]> {
  const { screenshots: _screenshots, ...cols } = getTableColumns(siteFeedback);
  return db
    .select({
      ...cols,
      hasScreenshots:
        sql<boolean>`(${siteFeedback.screenshots} IS NOT NULL AND jsonb_array_length(${siteFeedback.screenshots}) > 0)`.as(
          "has_screenshots",
        ),
      projectName: entities.name,
      liveUrl: sql<string | null>`(
        SELECT ${userProjects.liveUrl} FROM ${userProjects}
        WHERE ${userProjects.entityProjectId} = ${entities.id}
          AND ${userProjects.userId} = ${siteFeedback.userId}
          AND ${userProjects.isActive} = true
        ORDER BY ${userProjects.createdAt} ASC LIMIT 1
      )`.as("live_url"),
      runnable: sql<boolean>`EXISTS (
        SELECT 1 FROM ${userProjects}
        WHERE ${userProjects.entityProjectId} = ${entities.id}
          AND ${userProjects.userId} = ${siteFeedback.userId}
          AND ${userProjects.isActive} = true
          AND (${userProjects.dirPath} IS NOT NULL OR ${userProjects.gitUrl} IS NOT NULL)
      )`.as("runnable"),
    })
    .from(siteFeedback)
    .innerJoin(entities, eq(siteFeedback.projectId, entities.id))
    .where(
      sql`(${siteFeedback.userId} = ${userId} OR EXISTS (
        SELECT 1 FROM ${projectMemberships}
        WHERE ${projectMemberships.projectId} = ${siteFeedback.projectId}
          AND ${projectMemberships.userId} = ${userId}
          AND ${projectMemberships.role} = 'editor'
      ))`,
    )
    .orderBy(desc(siteFeedback.createdAt))
    .limit(limit);
}

export type ProjectFeedbackSummary = {
  projectId: string;
  projectName: string;
  newCount: number;
  /** new + dispatched — what the Control strip keys on so a project doesn't
   *  vanish mid-watch the moment its last NEW item is implemented. */
  openCount: number;
  latestAt: string;
};

/**
 * Fleet-wide lens over the per-project inboxes: projects with NEW feedback,
 * busiest first. Deliberately a QUERY, not a second store — the token binds
 * every row to its project and that stays the only source of truth.
 */
export async function listFeedbackSummary(userId: string): Promise<ProjectFeedbackSummary[]> {
  // OPEN rows (new + dispatched), split into both counts in one pass. NEW-only
  // here made the Control strip's project chip vanish the moment "Implement"
  // flipped its last NEW row to dispatched — exactly while the operator was
  // watching the fix run it promised to show.
  const rows = await db
    .select({
      projectId: siteFeedback.projectId,
      projectName: entities.name,
      newCount: sql<number>`count(*) filter (where ${siteFeedback.status} = ${FEEDBACK_STATUS.NEW})::int`,
      openCount: count(siteFeedback.id),
      latestAt: max(siteFeedback.createdAt),
    })
    .from(siteFeedback)
    .innerJoin(entities, eq(siteFeedback.projectId, entities.id))
    .where(
      and(
        sql`(${siteFeedback.userId} = ${userId} OR EXISTS (
          SELECT 1 FROM ${projectMemberships}
          WHERE ${projectMemberships.projectId} = ${siteFeedback.projectId}
            AND ${projectMemberships.userId} = ${userId}
            AND ${projectMemberships.role} = 'editor'
        ))`,
        inArray(siteFeedback.status, [FEEDBACK_STATUS.NEW, FEEDBACK_STATUS.DISPATCHED]),
      ),
    )
    .groupBy(siteFeedback.projectId, entities.name)
    .orderBy(desc(count(siteFeedback.id)), desc(sql`max(${siteFeedback.createdAt})`));
  return rows.map((r) => ({
    projectId: r.projectId,
    projectName: r.projectName,
    newCount: Number(r.newCount),
    openCount: Number(r.openCount),
    latestAt: (r.latestAt ?? new Date()).toISOString(),
  }));
}

/** Feedback plus its registered worker project. An entity alone cannot execute work. */
export async function getFeedbackWithProject(
  actorUserId: string,
  id: string,
): Promise<{
  feedback: SiteFeedback;
  projectName: string;
  userProjectId: string | null;
  agentPref: string | null;
  /** A folder or a repository — somewhere for the agent to work. */
  hasWorkspace: boolean;
  ownerUserId: string;
  canEdit: boolean;
} | null> {
  const [identity] = await db
    .select({ projectId: siteFeedback.projectId })
    .from(siteFeedback)
    .where(eq(siteFeedback.id, id))
    .limit(1);
  if (!identity) return null;
  const access = await getProjectAccess(actorUserId, identity.projectId);
  if (!access) return null;
  const [row] = await db
    .select({
      feedback: siteFeedback,
      projectName: entities.name,
      userProjectName: userProjects.name,
      userProjectId: userProjects.id,
      agentPref: userProjects.agentPref,
      hasWorkspace: sql<boolean>`(${userProjects.dirPath} IS NOT NULL OR ${userProjects.gitUrl} IS NOT NULL)`,
    })
    .from(siteFeedback)
    .innerJoin(entities, eq(siteFeedback.projectId, entities.id))
    .leftJoin(
      userProjects,
      and(
        eq(userProjects.entityProjectId, siteFeedback.projectId),
        eq(userProjects.userId, access.ownerUserId),
        eq(userProjects.isActive, true),
      ),
    )
    .where(and(eq(siteFeedback.id, id), eq(siteFeedback.userId, access.ownerUserId)))
    .limit(1);
  if (!row) return null;
  // The name is display/transport context; dispatch addresses feedback.projectId.
  return {
    feedback: row.feedback,
    projectName: row.userProjectName ?? row.projectName,
    userProjectId: row.userProjectId,
    agentPref: row.agentPref ?? null,
    hasWorkspace: row.hasWorkspace === true,
    ownerUserId: access.ownerUserId,
    canEdit: access.canEdit,
  };
}

/**
 * Bulk NEW→dispatched with run linkage — used when a digester DISPATCH_PROMPT
 * executes, so close-the-loop can auto-resolve the clustered items when the
 * run succeeds. Only rows still 'new' flip (an item the operator triaged in
 * the meantime is not clobbered).
 */
export async function markFeedbackDispatchedBulk(
  userId: string,
  ids: string[],
  runId?: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(siteFeedback)
    .set({ status: FEEDBACK_STATUS.DISPATCHED, ...(runId ? { dispatchedRunId: runId } : {}) })
    .where(
      and(
        eq(siteFeedback.userId, userId),
        inArray(siteFeedback.id, ids),
        eq(siteFeedback.status, FEEDBACK_STATUS.NEW),
      ),
    )
    .returning({ id: siteFeedback.id });
  return rows.length;
}

/** Status transition (triage). Ownership enforced via userId in the WHERE. */
export async function setFeedbackStatus(
  userId: string,
  id: string,
  status: FeedbackStatus,
  dispatchedRunId?: string,
): Promise<SiteFeedback | null> {
  const [updated] = await db
    .update(siteFeedback)
    .set({
      status,
      ...(dispatchedRunId ? { dispatchedRunId } : {}),
      // Resolution evidence: stamp when the row resolves, clear on reopen so a
      // re-resolved row never shows a stale date.
      resolvedAt:
        status === FEEDBACK_STATUS.RESOLVED
          ? new Date()
          : status === FEEDBACK_STATUS.NEW
            ? null
            : undefined,
    })
    .where(and(eq(siteFeedback.id, id), eq(siteFeedback.userId, userId)))
    .returning();
  return updated ?? null;
}
