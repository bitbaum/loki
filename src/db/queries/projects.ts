import { ENTITY_TYPE } from "@/lib/constants/statuses";
import { db } from "@/db";
import {
  entities,
  entityRelations,
  interactions,
  goals,
  userProjects,
  orgMemberships,
  orgs,
  siteSnapshots,
  promptHistory,
  projectStates,
  pendingCommands,
  projectMemberships,
} from "@/db/schema";
import { eq, and, asc, desc, inArray, ilike, isNull, or, isNotNull, max, sql } from "drizzle-orm";
import { excludeSmokeDispatchesSql } from "./smoke-filter";
import { attrValuesFromMeta, fetchAttributesWithMetaByEntityIds, getOrgPeerIds } from "./utils";
import { findProjectEntityByName } from "./project-merge";
import { z } from "zod";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { AUTO_INJECT_MODE_VALUES, type AutoInjectMode } from "@/config/beacon";

export const RECENT_INTERACTION_LIMIT = 5;

export const CreateProjectBody = z.object({
  name: z.string().trim().min(1, "name is required"),
  description: z.string().trim().optional(),
  /** Canonical repo URL (https://github.com/user/repo). Optional —
   *  set by GitHub-import flows and the cloud bootstrap. */
  gitUrl: z.string().trim().url().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectBody>;

export const PatchProjectBody = z
  .object({
    name: z.string().trim().min(1, "name cannot be empty").optional(),
    description: z.string().optional(),
    gitUrl: z.union([z.string().trim().url(), z.literal("")]).optional(),
    /** Per-project autopilot override. Pass null (or omit) to inherit the
     *  user-level beacon_settings.auto_inject_mode. Pass an AutoInjectMode
     *  value (e.g. "off", "queue_only", "strategist") to pin this project. */
    autoInjectModeOverride: z.union([z.enum(AUTO_INJECT_MODE_VALUES), z.null()]).optional(),
    /** Consent to appear in Loki's public catalogue at /fleet. Lives on
     *  user_projects, not entities — see patchProject. */
    listedPublicly: z.boolean().optional(),
    /** Operator's editorial pick for the landing hero. Accepted here but
     *  AUTHORIZED IN THE ROUTE (isSiteOperator) — a tenant must not be able to
     *  put themselves on the homepage by PATCHing their own project. */
    featured: z.boolean().optional(),
    /** "Not now" on the catalogue invitation. Write-once from the owner's own
     *  page; there is no un-dismiss, because the toggle beside it is the way
     *  back in and a second prompt would be the nagging this prevents. */
    dismissListingPrompt: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

type PatchProjectInput = z.infer<typeof PatchProjectBody>;

export async function createProject(userId: string, data: CreateProjectInput, source?: string) {
  const existing = await findProjectEntityByName(userId, data.name);
  if (existing) {
    throw new Error(`A project named "${existing.name}" already exists`);
  }

  const [created] = await db
    .insert(entities)
    .values({
      userId,
      name: data.name,
      type: ENTITY_TYPE.PROJECT,
      description: data.description || null,
      gitUrl: data.gitUrl || null,
      source: source ?? null,
    })
    .returning({ id: entities.id, name: entities.name, gitUrl: entities.gitUrl });

  // Also ensure a user_projects row exists. /api/control reads from
  // user_projects (not directly from entities), so without this row the new
  // project lives on /projects but is invisible on /control — the exact gap
  // user dogfood surfaced on 2026-06-06 with truthseeker (entity inserted via
  // bootstrap-style flow, no user_projects link, missing from /control).
  // dir_path stays null until the user clones locally and registers the path
  // via /control/import-local; the UI will eventually surface a "needs local
  // clone" affordance for these rows (v0.7.1 work).
  const [orgRow] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.ownerId, userId))
    .limit(1);
  await db
    .insert(userProjects)
    .values({
      userId,
      entityProjectId: created.id,
      name: created.name,
      description: data.description || null,
      gitUrl: data.gitUrl || null,
      dirPath: null,
      isActive: true,
      orgId: orgRow?.id ?? null,
    })
    .onConflictDoNothing();

  return created;
}

export async function patchProject(userId: string, id: string, data: PatchProjectInput) {
  const patch: Partial<typeof entities.$inferInsert> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description.trim() || null;
  if (data.gitUrl !== undefined) patch.gitUrl = data.gitUrl.trim() || null;
  if (data.autoInjectModeOverride !== undefined) {
    patch.autoInjectModeOverride = data.autoInjectModeOverride;
  }
  const [updated] = await db
    .update(entities)
    .set(patch)
    .where(and(eq(entities.id, id), eq(entities.userId, userId)))
    .returning({ id: entities.id });

  // Public-catalogue consent is a property of the user_projects row, which is
  // what /fleet reads — so it is written separately rather than folded into the
  // entities patch above. Always scoped by userId: consent is the owner's to
  // give, and an id alone must never be enough to publish someone's project.
  if (updated && (data.listedPublicly !== undefined || data.dismissListingPrompt)) {
    await db
      .update(userProjects)
      .set({
        ...(data.listedPublicly !== undefined ? { listedPublicly: data.listedPublicly } : {}),
        ...(data.dismissListingPrompt ? { listingPromptDismissedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(userProjects.userId, userId), eq(userProjects.entityProjectId, id)));
  }

  return updated ?? null;
}

/** Minimal identity lookup for routes that only need to verify ownership and
 *  grab the name/gitUrl (AI brief + repo enrichment). Null when the entity
 *  isn't the user's project. */
export async function getProjectCore(userId: string, id: string) {
  const row = await db.query.entities.findFirst({
    where: and(
      eq(entities.id, id),
      eq(entities.userId, userId),
      eq(entities.type, ENTITY_TYPE.PROJECT),
    ),
    columns: { id: true, name: true, gitUrl: true },
  });
  return row ?? null;
}

/**
 * Resolve a project's autopilot override by projectKey (the slug runners and
 * dispatch routes use). Returns null when there's no override OR when the
 * stored value isn't a known AutoInjectMode (defensive — the column has no
 * CHECK constraint so unknown values must be tolerated). Project lookup is
 * by exact name match; Loki bootstrap stores entities.name = projectKey
 * for cloud-created projects.
 */
export async function getProjectAutopilotOverride(
  userId: string,
  projectKey: string,
): Promise<AutoInjectMode | null> {
  const row = await db.query.entities.findFirst({
    where: and(
      eq(entities.userId, userId),
      eq(entities.name, projectKey),
      eq(entities.type, ENTITY_TYPE.PROJECT),
    ),
    columns: { autoInjectModeOverride: true },
  });
  const stored = row?.autoInjectModeOverride ?? null;
  if (!stored) return null;
  return AUTO_INJECT_MODE_VALUES.includes(stored as AutoInjectMode)
    ? (stored as AutoInjectMode)
    : null;
}

export async function deleteProject(userId: string, id: string) {
  const [project] = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(
      and(eq(entities.id, id), eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.PROJECT)),
    )
    .limit(1);
  if (!project) return null;

  await db
    .delete(userProjects)
    .where(
      and(
        eq(userProjects.userId, userId),
        or(eq(userProjects.entityProjectId, id), ilike(userProjects.name, project.name)),
      ),
    );

  // OPERATIONAL state goes; the AUDIT TRAIL stays.
  //
  // Every history table (orchestration_runs, agent_sessions, prompt_history,
  // control_audit_events) carries `project_key` beside `project_id`, so when the
  // id is nulled the row is still attributable by name and remains readable as
  // history. Those are kept deliberately: what an agent did for you is a record,
  // not clutter, and deleting it to tidy up a foreign key would destroy the only
  // account of work that really happened.
  //
  // These two are different. project_states is the Control card's live state,
  // keyed by (user_id, project_key) with no id to null — left behind, it makes a
  // ghost card and would silently re-attach to a NEW project that happens to
  // reuse the name. And an unexecuted pending_command is not a record of
  // anything: a runner would claim it and dispatch an agent into a project that
  // no longer exists.
  const stateKey = project.name.toLowerCase();
  await db
    .delete(projectStates)
    .where(and(eq(projectStates.userId, userId), eq(projectStates.projectKey, stateKey)));
  await db.delete(pendingCommands).where(
    and(
      eq(pendingCommands.userId, userId),
      isNull(pendingCommands.executedAt),
      // The project key lives in the payload, not a column — these commands are
      // addressed by name because the runner has no entity ids.
      sql`lower(coalesce(${pendingCommands.payload}->>'projectKey', ${pendingCommands.payload}->>'tab', '')) = ${stateKey}`,
    ),
  );

  // Milestones hang off the project entity with ON DELETE SET NULL, so deleting
  // a project used to leave its roadmap behind: unowned goals that still showed
  // on /goals, belonging to something the operator had just removed. Nulling the
  // link is right for a goal the user wrote themselves; these were written BY
  // the kickoff FOR this project, so they go with it.
  await db.delete(goals).where(and(eq(goals.userId, userId), eq(goals.entityId, id)));

  const [deleted] = await db
    .delete(entities)
    .where(and(eq(entities.id, id), eq(entities.userId, userId)))
    .returning({ id: entities.id });
  return deleted ?? null;
}

// Fetch the user_projects runtime metadata (dirPath + agentPref) for a list
// of entity ids. Returned map is keyed by entityProjectId — entities without
// a linked user_projects row are absent (caller treats as null).
//
// user_projects is the SSOT for where the project lives on disk and which
// agent it prefers; the Projects page card needs both so bare-attr tiles show
// concrete context instead of just a clickable title.
async function fetchRuntimeMetaByEntityIds(entityIds: string[]): Promise<
  Map<
    string,
    {
      dirPath: string | null;
      agentPref: string | null;
      builderPref: string | null;
      userProjectId: string;
      liveUrl: string | null;
      siteOk: boolean | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      dirPath: string | null;
      agentPref: string | null;
      builderPref: string | null;
      userProjectId: string;
      liveUrl: string | null;
      siteOk: boolean | null;
    }
  >();
  if (entityIds.length === 0) return out;
  const rows = await db
    .select({
      entityProjectId: userProjects.entityProjectId,
      userProjectId: userProjects.id,
      dirPath: userProjects.dirPath,
      agentPref: userProjects.agentPref,
      builderPref: userProjects.builderPref,
      liveUrl: userProjects.liveUrl,
      siteOk: siteSnapshots.ok,
    })
    .from(userProjects)
    .leftJoin(siteSnapshots, eq(siteSnapshots.projectId, userProjects.id))
    .where(inArray(userProjects.entityProjectId, entityIds));
  for (const r of rows) {
    if (r.entityProjectId) {
      out.set(r.entityProjectId, {
        dirPath: r.dirPath,
        agentPref: r.agentPref,
        builderPref: r.builderPref,
        userProjectId: r.userProjectId,
        liveUrl: r.liveUrl,
        siteOk: r.siteOk,
      });
    }
  }
  return out;
}

export async function getProjects(userId: string) {
  const projects = await db
    .select()
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.PROJECT)))
    .orderBy(entities.name);

  const ids = projects.map((p) => p.id);
  // The META variant, not the flat one: same single query, but it keeps the
  // `updatedAt` / `source` / `validUntil` the flat version discards. The list
  // needs them to say how old a flag is and where it came from — a bare
  // "Security risk" with no date is what let a note typed months ago pin a
  // project to the top of the page indefinitely.
  const [attrMetaByEntity, runtimeByEntity] = await Promise.all([
    fetchAttributesWithMetaByEntityIds(ids),
    fetchRuntimeMetaByEntityIds(ids),
  ]);

  return projects.map((p) => {
    const runtime = runtimeByEntity.get(p.id);
    const attrMeta = attrMetaByEntity.get(p.id) ?? {};
    return {
      ...p,
      attrs: attrValuesFromMeta(attrMeta),
      attrMeta,
      dirPath: runtime?.dirPath ?? null,
      agentPref: runtime?.agentPref ?? null,
      builderPref: runtime?.builderPref ?? null,
      userProjectId: runtime?.userProjectId ?? null,
      liveUrl: runtime?.liveUrl ?? null,
      siteOk: runtime?.siteOk ?? null,
    };
  });
}

export type ProjectRow = Awaited<ReturnType<typeof getProjects>>[number];

/**
 * Newest real dispatch per entity project — the list page's "what moved?"
 * signal. Sourced from prompt_history (has the entity FK and the smoke-marker
 * filter, so probe traffic can't make an idle project look active). Returned
 * as a plain Record so a server component can pass it straight to the client.
 */
export async function getProjectsLastDispatch(userId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ projectId: promptHistory.projectId, last: max(promptHistory.dispatchedAt) })
    .from(promptHistory)
    .where(
      and(
        eq(promptHistory.userId, userId),
        isNotNull(promptHistory.projectId),
        excludeSmokeDispatchesSql(),
      ),
    )
    .groupBy(promptHistory.projectId);
  return Object.fromEntries(
    rows
      .filter((r): r is { projectId: string; last: Date } => !!r.projectId && !!r.last)
      .map((r) => [r.projectId, r.last.toISOString()]),
  );
}

/** Returns entity-level project profiles belonging to org peers (read-only for the viewer). */
export async function getOrgEntityProjects(
  userId: string,
): Promise<(ProjectRow & { readonly: true })[]> {
  const peerIds = await getOrgPeerIds(userId);
  const explicit = await db
    .select({ projectId: projectMemberships.projectId })
    .from(projectMemberships)
    .where(eq(projectMemberships.userId, userId));
  const explicitIds = explicit.map((row) => row.projectId);
  if (peerIds.length === 0 && explicitIds.length === 0) return [];
  const access = [
    ...(peerIds.length ? [inArray(entities.userId, peerIds)] : []),
    ...(explicitIds.length ? [inArray(entities.id, explicitIds)] : []),
  ];
  const projects = await db
    .select()
    .from(entities)
    .where(and(or(...access), eq(entities.type, ENTITY_TYPE.PROJECT)))
    .orderBy(entities.name);
  const ids = projects.map((p) => p.id);
  // Meta here too. A team project's flags are no less in need of a date than
  // your own — and a row that silently lacked provenance would read as "this
  // flag has no age" rather than "we did not fetch it".
  const [attrMetaByEntity, runtimeByEntity] = await Promise.all([
    fetchAttributesWithMetaByEntityIds(ids),
    fetchRuntimeMetaByEntityIds(ids),
  ]);
  return projects.map((p) => {
    const runtime = runtimeByEntity.get(p.id);
    const attrMeta = attrMetaByEntity.get(p.id) ?? {};
    return {
      ...p,
      attrs: attrValuesFromMeta(attrMeta),
      attrMeta,
      dirPath: runtime?.dirPath ?? null,
      agentPref: runtime?.agentPref ?? null,
      builderPref: runtime?.builderPref ?? null,
      userProjectId: runtime?.userProjectId ?? null,
      liveUrl: runtime?.liveUrl ?? null,
      siteOk: runtime?.siteOk ?? null,
      readonly: true as const,
    };
  });
}

/**
 * Resolves project detail for a viewer who may not own the entity.
 * Falls back to org-member access: if the entity belongs to a peer in the
 * same org, returns the detail fetched under the owner's userId (read-only
 * from the viewer's perspective — PATCH/DELETE still require ownership).
 *
 * Returns { detail, ownerId } or null if no access.
 */
export async function resolveProjectDetailWithOrgFallback(
  viewerUserId: string,
  projectId: string,
): Promise<{
  detail: NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
  ownerId: string;
  canEdit: boolean;
} | null> {
  // Fast path: viewer owns the entity.
  const ownDetail = await getProjectDetail(viewerUserId, projectId);
  if (ownDetail) return { detail: ownDetail, ownerId: viewerUserId, canEdit: true };

  // Look up the entity without userId filter to find its actual owner.
  const [entity] = await db
    .select({ id: entities.id, userId: entities.userId })
    .from(entities)
    .where(and(eq(entities.id, projectId), eq(entities.type, ENTITY_TYPE.PROJECT)))
    .limit(1);

  if (!entity || entity.userId === viewerUserId) return null;

  const [projectMember] = await db
    .select({ role: projectMemberships.role })
    .from(projectMemberships)
    .where(
      and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, viewerUserId)),
    )
    .limit(1);
  if (projectMember) {
    const detail = await getProjectDetail(entity.userId, projectId);
    return detail
      ? { detail, ownerId: entity.userId, canEdit: projectMember.role === "editor" }
      : null;
  }

  // Check that viewer and owner share at least one org.
  const viewerOrgs = await db
    .select({ orgId: orgMemberships.orgId })
    .from(orgMemberships)
    .where(eq(orgMemberships.userId, viewerUserId));

  if (viewerOrgs.length === 0) return null;
  const orgIds = viewerOrgs.map((m) => m.orgId);

  const shared = await db
    .select({ id: orgMemberships.orgId })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, entity.userId), inArray(orgMemberships.orgId, orgIds)))
    .limit(1);

  if (shared.length === 0) return null;

  const detail = await getProjectDetail(entity.userId, projectId);
  return detail ? { detail, ownerId: entity.userId, canEdit: false } : null;
}

export async function getProjectDetail(userId: string, id: string) {
  const [project] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.id, id), eq(entities.userId, userId)));

  if (!project) return null;

  const privateLocked = await isPrivateZoneLocked(userId);
  const goalsPromise = privateLocked
    ? Promise.resolve([])
    : db
        .select({
          id: goals.id,
          title: goals.title,
          description: goals.description,
          status: goals.status,
          progress: goals.progress,
          targetDate: goals.targetDate,
          milestones: goals.milestones,
          createdAt: goals.createdAt,
        })
        .from(goals)
        .where(and(eq(goals.entityId, id), eq(goals.userId, userId)))
        // Progress orders the list, creation breaks ties: a generated roadmap
        // is all-zero on day one, and without the tiebreaker its build order
        // came back in whatever order the DB felt like — so "milestone 1" was
        // not reproducibly milestone 1.
        .orderBy(desc(goals.progress), asc(goals.createdAt));

  // Meta, not the flat map: the project page's Flags panel needs to say when
  // each flag was written and by what. Same single query either way.
  const [attrMap, relations, recentInteractions, linkedGoals, userProject] = await Promise.all([
    fetchAttributesWithMetaByEntityIds([id]),
    db
      .select()
      .from(entityRelations)
      .where(and(eq(entityRelations.fromEntityId, id), eq(entityRelations.userId, userId))),
    db
      .select()
      .from(interactions)
      .where(and(eq(interactions.entityId, id), eq(interactions.userId, userId)))
      .orderBy(desc(interactions.occurredAt))
      .limit(RECENT_INTERACTION_LIMIT),
    goalsPromise,
    db.query.userProjects
      .findFirst({
        where: and(eq(userProjects.userId, userId), eq(userProjects.entityProjectId, project.id)),
        columns: { devLog: true, resources: true, notes: true },
      })
      .then(
        (linked) =>
          linked ??
          db.query.userProjects.findFirst({
            where: and(eq(userProjects.userId, userId), ilike(userProjects.name, project.name)),
            columns: { devLog: true, resources: true, notes: true },
          }),
      ),
  ]);

  const relatedIds = relations.map((r) => r.toEntityId);
  const relatedEntities =
    relatedIds.length > 0
      ? await db
          .select({ id: entities.id, name: entities.name, type: entities.type })
          .from(entities)
          .where(and(eq(entities.userId, userId), inArray(entities.id, relatedIds)))
      : [];

  return {
    project,
    createdAt: project.createdAt,
    attrs: attrValuesFromMeta(attrMap.get(id)),
    attrMeta: attrMap.get(id) ?? {},
    relations: relations.map((r) => ({
      type: r.type,
      strength: r.strength,
      targetId: r.toEntityId,
      targetName: relatedEntities.find((e) => e.id === r.toEntityId)?.name ?? r.toEntityId,
      targetType: relatedEntities.find((e) => e.id === r.toEntityId)?.type ?? "unknown",
    })),
    recentInteractions: recentInteractions.map((i) => ({
      channel: i.channel,
      direction: i.direction,
      summary: i.summary,
      occurredAt: i.occurredAt,
    })),
    linkedGoals,
    // An empty list means "no goals"; this flag means "goals exist or not, you
    // are not being shown them". Callers that decide something from goal count
    // (the kickoff plan, the roadmap dispatch) must not read locked as empty.
    goalsLocked: privateLocked,
    devLog: userProject?.devLog ?? null,
    resources: userProject?.resources ?? [],
    notes: userProject?.notes ?? null,
  };
}

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
