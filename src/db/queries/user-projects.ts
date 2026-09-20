import { and, asc, count, eq, ilike, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { promoteDevLogEntry } from "@/lib/integrations/orangecat-publish";
import { entities, orgs, userProjects, type NewUserProject, type UserProject } from "@/db/schema";
import type { DevLogEntry } from "@/db/schema/user-projects";
import { ENTITY_TYPE } from "@/lib/constants/statuses";
import { getOrgPeerIds } from "./utils";
import { findProjectEntityByName } from "./project-merge";
import { isPublicTestArtifact } from "@/lib/project-display";
import { getProjectByOrangeCatEntity } from "./orangecat-links";

export async function getUserProjects(userId: string): Promise<UserProject[]> {
  return db
    .select()
    .from(userProjects)
    .where(and(eq(userProjects.userId, userId), eq(userProjects.isActive, true)))
    .orderBy(asc(userProjects.position), asc(userProjects.createdAt));
}

/**
 * Returns active projects belonging to other members of the user's orgs.
 * Queries by org membership (not orgId on the project) so it works
 * regardless of whether projects have been explicitly org-tagged.
 */
export async function getOrgProjects(userId: string): Promise<UserProject[]> {
  // Include the caller themselves — getOrgPeerIds excludes self by design (it
  // answers "who else is in my orgs"), but the caller's own projects belong in
  // the visible set too. Without this, a solo user with no org peers gets [].
  const peerIds = await getOrgPeerIds(userId);
  const memberIds = [userId, ...peerIds];
  return db
    .select()
    .from(userProjects)
    .where(and(inArray(userProjects.userId, memberIds), eq(userProjects.isActive, true)))
    .orderBy(asc(userProjects.position), asc(userProjects.createdAt));
}

export async function countActiveProjects(userId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(userProjects)
    .where(and(eq(userProjects.userId, userId), eq(userProjects.isActive, true)));
  return value;
}

async function findOrCreateProjectEntity(
  userId: string,
  name: string,
  description?: string | null,
): Promise<string> {
  const existing = await findProjectEntityByName(userId, name);
  if (existing) return existing.id;

  const [created] = await db
    .insert(entities)
    .values({
      userId,
      name,
      type: ENTITY_TYPE.PROJECT,
      description: description?.trim() || null,
      source: "control",
    })
    .returning({ id: entities.id });

  return created.id;
}

export async function ensureUserProjectEntityLinks(userId: string): Promise<UserProject[]> {
  const projects = await getUserProjects(userId);
  const linked: UserProject[] = [];

  for (const project of projects) {
    if (project.entityProjectId) {
      linked.push(project);
      continue;
    }

    const entityProjectId = await findOrCreateProjectEntity(
      userId,
      project.name,
      project.description,
    );
    const [updated] = await db
      .update(userProjects)
      .set({ entityProjectId, updatedAt: new Date() })
      .where(and(eq(userProjects.id, project.id), eq(userProjects.userId, userId)))
      .returning();

    linked.push(updated ?? { ...project, entityProjectId });
  }

  return linked;
}

export async function getPublicProjects(userId: string): Promise<UserProject[]> {
  const rows = await db
    .select()
    .from(userProjects)
    .where(
      and(
        eq(userProjects.userId, userId),
        eq(userProjects.isActive, true),
        isNotNull(userProjects.gitUrl),
      ),
    )
    .orderBy(asc(userProjects.position), asc(userProjects.createdAt));
  // Defense-in-depth for the public face (landing hero, /u profiles): never
  // surface a smoke/dogfood artifact even if one leaks into the DB. See
  // isPublicTestArtifact.
  return rows.filter((p) => !isPublicTestArtifact(p.name));
}

/**
 * Projects whose owner has opted them into Loki's OWN public catalogue (/fleet).
 *
 * Distinct from getPublicProjects, and the difference is who is speaking. A
 * profile at /u/[username] is the USER showing their work, so "active, has a
 * repo" is a fair reading of intent. /fleet is the PRODUCT showing a catalogue,
 * and a multi-tenant product may not enrol a tenant by inference — so this asks
 * for a stored decision (listed_publicly) and nothing else will do.
 *
 * Not scoped to one account on purpose. /fleet used to resolve a single owner
 * via getSelfImprovementTarget() and publish everything they had; consent is a
 * property of the project, so the catalogue is now every consenting project
 * regardless of who owns it — which is also what makes the page meaningful once
 * Loki has more than one user.
 */
export async function getPubliclyListedProjects(): Promise<UserProject[]> {
  const rows = await db
    .select()
    .from(userProjects)
    .where(and(eq(userProjects.listedPublicly, true), eq(userProjects.isActive, true)))
    .orderBy(asc(userProjects.position), asc(userProjects.createdAt));
  return rows.filter((p) => !isPublicTestArtifact(p.name));
}

/**
 * Record a NEW session handoff as a changelog entry (devLog) — the single
 * append point behind both handoff ingestion paths: /api/control (local
 * runtime reads the session file directly) and /api/control/runtime-state
 * (cloud: the runner pushes it). The cloud path once skipped this entirely,
 * so box-executed runs closed without ever reaching the project changelog —
 * or the OrangeCat wall (appendProjectDevLog* fires promoteDevLogEntry).
 * Guard: only when the done text actually changed vs the previous handoff,
 * so heartbeats re-pushing the same session never duplicate entries.
 */
export async function recordSessionHandoffChangelog(
  userId: string,
  input: {
    projectId?: string | null;
    tab: string;
    dateMs: number;
    previousDone: string | null | undefined;
    done?: string;
    next?: string;
    tests?: string;
    todos?: string;
    health?: string;
  },
): Promise<void> {
  const doneTrimmed = input.done?.trim();
  if (!doneTrimmed || doneTrimmed === input.previousDone?.trim()) return;

  // Garbage gate. The changelog is a user-facing record (project pages, the
  // OrangeCat wall) — writers that lie must be corrected at the door:
  //   - a "done" that is actually an error dump must not carry health:good
  //     (the retired hosted-Hermes path wrote "API call failed …" four times
  //     with health good — rendered verbatim on the project page, 2026-07-03);
  //   - repeats of a recent entry (retries, double-claims) must not stack.
  const FAILURE_SIGNATURE =
    /api call failed|401 invalid|please run \/login|error:|made no file changes/i;
  const looksFailed =
    FAILURE_SIGNATURE.test(doneTrimmed) || FAILURE_SIGNATURE.test(input.next ?? "");
  const project = await db.query.userProjects.findFirst({
    where: input.projectId
      ? and(eq(userProjects.userId, userId), eq(userProjects.entityProjectId, input.projectId))
      : and(eq(userProjects.userId, userId), ilike(userProjects.name, input.tab)),
    columns: { devLog: true },
  });
  const recent = ((project?.devLog ?? []) as DevLogEntry[]).slice(-3);
  if (recent.some((e) => e.done.trim() === doneTrimmed)) return;

  const entry: DevLogEntry = {
    date: new Date(input.dateMs).toISOString(),
    done: doneTrimmed,
    next: input.next?.trim() ?? "",
    tests: input.tests?.trim() ?? "",
    todos: input.todos?.trim() ?? "",
    health: looksFailed ? "broken" : input.health?.trim() || "good",
  };
  if (input.projectId) {
    await appendProjectDevLogByEntityProjectId(userId, input.projectId, entry);
  } else {
    await appendProjectDevLog(userId, input.tab, entry);
  }
}

/** The user_projects row backing an entity project (devLog, gitUrl, OC link). */
export async function getUserProjectByEntityId(
  userId: string,
  entityProjectId: string,
): Promise<UserProject | null> {
  const row = await db.query.userProjects.findFirst({
    where: and(eq(userProjects.userId, userId), eq(userProjects.entityProjectId, entityProjectId)),
  });
  return row ?? null;
}

/**
 * Reverse lookup across the FC↔OC link: the project a published OrangeCat
 * entity belongs to. Cross-user by design — OC webhooks identify the project,
 * not the operator; the row carries the owning userId.
 */
export async function getUserProjectByOrangeCatProjectId(
  orangecatProjectId: string,
): Promise<UserProject | null> {
  const linked = await getProjectByOrangeCatEntity("project", orangecatProjectId);
  if (linked?.project) return linked.project;
  const row = await db.query.userProjects.findFirst({
    where: eq(userProjects.orangecatProjectId, orangecatProjectId),
  });
  return row ?? null;
}

/**
 * Keep the projects-page one-liner (user_projects.description) in sync with the
 * entity brief. A project has two description homes — the entity (dossier / RAG)
 * and the user_projects row (the fleet-index one-liner). When a brief write
 * updates the entity, this mirrors it so the fleet index reflects saved context
 * too, not just the dossier. No-op when the project has no linked user_projects row.
 */
export async function syncUserProjectDescription(
  userId: string,
  entityProjectId: string,
  description: string,
): Promise<void> {
  await db
    .update(userProjects)
    .set({ description: description.trim() || null, updatedAt: new Date() })
    .where(and(eq(userProjects.userId, userId), eq(userProjects.entityProjectId, entityProjectId)));
}

export async function getUserProject(id: string, userId: string): Promise<UserProject | null> {
  const [row] = await db
    .select()
    .from(userProjects)
    .where(and(eq(userProjects.id, id), eq(userProjects.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function createUserProject(
  data: Omit<NewUserProject, "id" | "createdAt" | "updatedAt">,
): Promise<UserProject> {
  const entityProjectId =
    data.entityProjectId ??
    (await findOrCreateProjectEntity(data.userId, data.name, data.description));

  // Auto-link to the user's primary org so team members can see it via getOrgProjects.
  let orgId = data.orgId ?? null;
  if (!orgId) {
    const [orgRow] = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(eq(orgs.ownerId, data.userId))
      .limit(1);
    orgId = orgRow?.id ?? null;
  }

  const [row] = await db
    .insert(userProjects)
    .values({ ...data, entityProjectId, orgId })
    .returning();
  return row;
}

export async function upsertLocalUserProject(
  data: Pick<NewUserProject, "userId" | "name" | "dirPath"> &
    Partial<Pick<NewUserProject, "gitUrl" | "description" | "agentPref" | "modelPref">>,
): Promise<UserProject> {
  const entityProjectId = await findOrCreateProjectEntity(data.userId, data.name, data.description);

  let orgId: string | null = null;
  const [orgRow] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.ownerId, data.userId))
    .limit(1);
  orgId = orgRow?.id ?? null;

  const values = {
    userId: data.userId,
    name: data.name,
    dirPath: data.dirPath,
    gitUrl: data.gitUrl ?? null,
    description: data.description ?? null,
    agentPref: data.agentPref ?? null,
    modelPref: data.modelPref ?? null,
    entityProjectId,
    orgId,
    isActive: true,
  };

  const [row] = await db
    .insert(userProjects)
    .values(values)
    .onConflictDoUpdate({
      target: [userProjects.userId, userProjects.name],
      set: {
        dirPath: values.dirPath,
        gitUrl: values.gitUrl,
        description: values.description,
        entityProjectId,
        orgId,
        isActive: true,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
}

export async function updateUserProject(
  id: string,
  userId: string,
  data: Partial<
    Pick<
      UserProject,
      | "name"
      | "dirPath"
      | "gitUrl"
      | "description"
      | "stack"
      | "agentPref"
      | "modelPref"
      | "builderPref"
      | "position"
      | "isActive"
      | "notes"
      | "resources"
    >
  >,
): Promise<UserProject | null> {
  const [row] = await db
    .update(userProjects)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(userProjects.id, id), eq(userProjects.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteUserProject(id: string, userId: string): Promise<void> {
  await db
    .delete(userProjects)
    .where(and(eq(userProjects.id, id), eq(userProjects.userId, userId)));
}

const DEV_LOG_MAX = 50;

async function writeDevLog(id: string, existing: DevLogEntry[], entry: DevLogEntry): Promise<void> {
  const updated = [...existing, entry].slice(-DEV_LOG_MAX);
  await db
    .update(userProjects)
    .set({ devLog: updated, updatedAt: new Date() })
    .where(eq(userProjects.id, id));
}

/**
 * Append a dev log entry identified by project name, capping at DEV_LOG_MAX.
 * No-ops for projects not in DB. Caller is responsible for deduplication.
 */
export async function appendProjectDevLog(
  userId: string,
  projectName: string,
  entry: DevLogEntry,
): Promise<void> {
  const project = await db.query.userProjects.findFirst({
    where: and(eq(userProjects.userId, userId), ilike(userProjects.name, projectName)),
    columns: { id: true, devLog: true, name: true },
  });
  if (!project) return;
  await writeDevLog(project.id, (project.devLog ?? []) as DevLogEntry[], entry);
  // Changelog→wall promote step (async, idempotent, non-blocking) — no-ops
  // unless the project is published to OrangeCat and the user is linked.
  void promoteDevLogEntry(userId, project.id, project.name, entry);
}

export async function appendProjectDevLogByEntityProjectId(
  userId: string,
  entityProjectId: string,
  entry: DevLogEntry,
): Promise<void> {
  const project = await db.query.userProjects.findFirst({
    where: and(eq(userProjects.userId, userId), eq(userProjects.entityProjectId, entityProjectId)),
    columns: { id: true, devLog: true, name: true },
  });
  if (!project) return;
  await writeDevLog(project.id, (project.devLog ?? []) as DevLogEntry[], entry);
  void promoteDevLogEntry(userId, project.id, project.name, entry);
}

/**
 * Returns all distinct userIds that have registered projects.
 * Used by the runner when claiming pending commands — the runner services all
 * local projects regardless of which DB user row owns them, so we must drain
 * commands for every userId rather than just the isDefault one.
 */
export async function getAllDistinctUserIds(): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: userProjects.userId }).from(userProjects);
  return rows.map((r) => r.userId);
}

/** Registered projects for a set of project entities — one round trip for a
 *  list that needs each row's live URL / repo (the feedback inbox). */
export async function getUserProjectsByEntityIds(
  userId: string,
  entityProjectIds: string[],
): Promise<Map<string, UserProject>> {
  if (!entityProjectIds.length) return new Map();
  const rows = await db.query.userProjects.findMany({
    where: and(
      eq(userProjects.userId, userId),
      inArray(userProjects.entityProjectId, entityProjectIds),
    ),
  });
  const out = new Map<string, UserProject>();
  for (const r of rows)
    if (r.entityProjectId && !out.has(r.entityProjectId)) out.set(r.entityProjectId, r);
  return out;
}

/**
 * Turn "ship fixes automatically" on or off for one project, addressed by its
 * ENTITY id (the id the project page holds). Explicit false is stored, not
 * cleared: null means "never chosen" and the UI treats the two differently.
 */
export async function setProjectAutoShip(
  userId: string,
  entityProjectId: string,
  autoShip: boolean,
): Promise<UserProject | null> {
  const [row] = await db
    .update(userProjects)
    .set({ autoShip })
    .where(and(eq(userProjects.userId, userId), eq(userProjects.entityProjectId, entityProjectId)))
    .returning();
  return row ?? null;
}
