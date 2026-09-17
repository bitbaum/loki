import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { orchestrationRuns } from "@/db/schema/orchestration-runs";
import { attributes } from "@/db/schema/attributes";
import { goals } from "@/db/schema/goals";
import { PUBLIC_IDENTITY_ATTRS } from "@/config/project-attrs";
import { getUserProjects } from "@/db/queries/user-projects";
import { getSelfImprovementTarget } from "@/db/queries/frontier";
import { readAppsConf } from "@/lib/register/apps-conf";
import { buildFleetRegister, canonicalSlug, repoFromGitUrl } from "@/lib/register/build";
import { solonClaims } from "@/lib/register/solon";
import { ORCH_STATE } from "@/lib/orchestration/contract";
import {
  buildFleetMap,
  type FleetMap,
  type MapActivity,
  type MapProfile,
} from "@/lib/register/map";

/**
 * The I/O half of the fleet map: the register join for the studio owner, the
 * profile columns only Loki holds (stack, dev log), and per-project activity
 * (open runs, last finished run). Shared by the API route and the nightly
 * knowledge reindex so the page and the assistant read the same map.
 */
export async function loadFleetMap(): Promise<FleetMap | null> {
  const owner = await getSelfImprovementTarget();
  if (!owner) return null;
  const [projects, solon] = await Promise.all([getUserProjects(owner.userId), solonClaims()]);
  const rows = buildFleetRegister(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      hostedApp: p.hostedApp,
      gitUrl: p.gitUrl,
      liveUrl: p.liveUrl,
      orangecatProjectId: p.orangecatProjectId,
      solonOrgSlug: p.solonOrgSlug,
      isActive: p.isActive,
    })),
    readAppsConf(),
    solon.claims,
  );

  // The identity half of the profile lives on the ENTITY, not on user_projects:
  // the four public attributes in `attributes`, the roadmap in `goals`. Both are
  // joined by entity_project_id, and both are read here in one query each rather
  // than per project — 35 projects would otherwise be 70 round trips.
  const entityIds = projects
    .map((p) => p.entityProjectId)
    .filter((id): id is string => typeof id === "string");

  const [identityRows, goalRows] = await Promise.all([
    entityIds.length
      ? db
          .select({ entityId: attributes.entityId, key: attributes.key, value: attributes.value })
          .from(attributes)
          .where(
            and(
              inArray(attributes.entityId, entityIds),
              // The allowlist is applied in the QUERY, so a key outside it is
              // never even read into a process that serves the public internet.
              inArray(attributes.key, [...PUBLIC_IDENTITY_ATTRS]),
            ),
          )
      : Promise.resolve([]),
    entityIds.length
      ? db
          .select({
            entityId: goals.entityId,
            title: goals.title,
            status: goals.status,
            progress: goals.progress,
            targetDate: goals.targetDate,
            milestones: goals.milestones,
          })
          .from(goals)
          .where(inArray(goals.entityId, entityIds))
          .orderBy(goals.createdAt)
      : Promise.resolve([]),
  ]);

  const identityByEntity = new Map<string, Record<string, string>>();
  for (const r of identityRows) {
    if (!r.entityId) continue;
    const bag = identityByEntity.get(r.entityId) ?? {};
    bag[r.key] = r.value;
    identityByEntity.set(r.entityId, bag);
  }

  const goalsByEntity = new Map<string, MapProfile["goals"]>();
  for (const g of goalRows) {
    if (!g.entityId) continue;
    const list = goalsByEntity.get(g.entityId) ?? [];
    list!.push({
      title: g.title,
      status: g.status,
      progress: g.progress,
      targetDate: g.targetDate ? g.targetDate.toISOString() : null,
      milestones: Array.isArray(g.milestones) ? g.milestones : null,
    });
    goalsByEntity.set(g.entityId, list);
  }

  const profiles = new Map<string, MapProfile>();
  const keyToSlug = new Map<string, string>();
  for (const p of projects) {
    const slug = canonicalSlug(p.slug || repoFromGitUrl(p.gitUrl) || p.name);
    const eid = p.entityProjectId;
    profiles.set(slug, {
      stack: p.stack,
      devLog: p.devLog,
      identity: eid ? (identityByEntity.get(eid) ?? null) : null,
      goals: eid ? (goalsByEntity.get(eid) ?? null) : null,
    });
    keyToSlug.set(p.name, slug);
    keyToSlug.set(slug, slug);
  }

  const keys = [...keyToSlug.keys()];
  const activity = new Map<string, MapActivity>();
  if (keys.length) {
    const [open, finished] = await Promise.all([
      db
        .select({ projectKey: orchestrationRuns.projectKey })
        .from(orchestrationRuns)
        .where(
          and(
            eq(orchestrationRuns.userId, owner.userId),
            inArray(orchestrationRuns.projectKey, keys),
            inArray(orchestrationRuns.state, [ORCH_STATE.WAITING, ORCH_STATE.RUNNING]),
            isNull(orchestrationRuns.finishedAt),
          ),
        ),
      db
        .selectDistinctOn([orchestrationRuns.projectKey], {
          projectKey: orchestrationRuns.projectKey,
          outcome: orchestrationRuns.outcome,
          finishedAt: orchestrationRuns.finishedAt,
        })
        .from(orchestrationRuns)
        .where(
          and(
            eq(orchestrationRuns.userId, owner.userId),
            inArray(orchestrationRuns.projectKey, keys),
            isNotNull(orchestrationRuns.outcome),
            isNotNull(orchestrationRuns.finishedAt),
          ),
        )
        .orderBy(orchestrationRuns.projectKey, desc(orchestrationRuns.finishedAt)),
    ]);
    for (const r of open) {
      const slug = keyToSlug.get(r.projectKey);
      if (!slug) continue;
      const a = activity.get(slug) ?? { openRuns: 0, lastRun: null };
      a.openRuns += 1;
      activity.set(slug, a);
    }
    for (const r of finished) {
      const slug = keyToSlug.get(r.projectKey);
      if (!slug || !r.outcome || !r.finishedAt) continue;
      const a = activity.get(slug) ?? { openRuns: 0, lastRun: null };
      if (!a.lastRun || a.lastRun.at < r.finishedAt)
        a.lastRun = { outcome: r.outcome, at: r.finishedAt };
      activity.set(slug, a);
    }
  }

  return buildFleetMap(rows, profiles, activity);
}
