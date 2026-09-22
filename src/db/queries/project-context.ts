/**
 * Project context for autonomous dispatch — SSOT for "what is this project trying
 * to achieve". Returns the project's brief (entity description) + its active goals
 * (the roadmap), formatted for injection into the agent's prompt so "next best"
 * is judged against the actual goals instead of being generic.
 *
 * Reused by the orchestration render path (renderTaskForAdapter callers) and the
 * nudge-idle cron — one source, so the autopilot always aims at the same context
 * the operator sees in the product (Projects brief + Goals).
 */
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { entities, goals, userProjects } from "@/db/schema";
import type { Milestone } from "@/db/schema/goals";
import { ENTITY_TYPE, GOAL_STATUS } from "@/lib/constants/statuses";
import { PROJECT_DRIVING_FIELDS } from "@/config/project-attrs";
import { renderOperatingPrinciples } from "@/config/operating-principles";
import { getProjectDossierByProjectKey, renderProjectDossierForAgent } from "./project-dossier";
import { fetchAttributesByEntityIds } from "./utils";
import { DEFAULT_GOAL_MAX_TURNS } from "@/lib/orchestration/dod-gate";
import { answer } from "@/lib/project-display";

const MAX_GOALS = 6;

// The structured profile fields that drive HOW a project should be built —
// injected into every dispatch so the agent works to the project's actual
// mission, stack, architecture, conventions, and bar for "done", not generics.
// The market-lens fields (competitors, expansion ideas, …) are for the human
// operator, so they're deliberately excluded to keep the prompt focused + cheap.
// Distribution and go-to-market are deliberately INCLUDED — they drive what
// agents build toward (who it must reach and how it earns), unlike market lens.
// DERIVED from the field registry (config/project-attrs.ts) — the one place a
// project field is described. Note this is the FALLBACK path: getProjectContext
// below returns the dossier whenever the project has one, so most dispatches
// never reach these lines. Re-exported under the old name so call sites and the
// comments that reference DRIVING_FIELDS keep working.
export const DRIVING_FIELDS = PROJECT_DRIVING_FIELDS;

/**
 * Formatted brief + active goals for a project, or null when the project has no
 * description and no active goals (so callers can omit the section entirely).
 */
export async function getProjectContext(
  userId: string,
  projectKey: string,
): Promise<string | null> {
  const dossier = await getProjectDossierByProjectKey(userId, projectKey).catch(() => null);
  if (dossier) return renderProjectDossierForAgent(dossier);

  // Global tier first — the founder's cross-project engineering standards apply
  // to every dispatch regardless of whether this project has a brief/goals yet.
  const blocks: string[] = [renderOperatingPrinciples()];

  // Resolve the project entity by name (case-insensitive, matching the inject
  // route's own canonical-tab resolution).
  const projectEntities = await db
    .select({ id: entities.id, name: entities.name, description: entities.description })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.PROJECT)));
  const entity = projectEntities.find((e) => e.name.toLowerCase() === projectKey.toLowerCase());

  if (entity) {
    const [activeGoals, attrsByEntity, runtimeProject] = await Promise.all([
      db
        .select({ title: goals.title, progress: goals.progress, milestones: goals.milestones })
        .from(goals)
        .where(
          and(
            eq(goals.userId, userId),
            eq(goals.entityId, entity.id),
            eq(goals.status, GOAL_STATUS.ACTIVE),
          ),
        )
        .orderBy(desc(goals.updatedAt))
        .limit(MAX_GOALS),
      fetchAttributesByEntityIds([entity.id]),
      db.query.userProjects.findFirst({
        where: and(eq(userProjects.userId, userId), eq(userProjects.entityProjectId, entity.id)),
        columns: { notes: true, resources: true },
      }),
    ]);
    const attrs = attrsByEntity.get(entity.id) ?? {};

    const projectLines: string[] = [];
    // Some projects store their filesystem path in `description` — that's noise
    // in a prompt, so only include a real, prose brief (not a path).
    const briefText = entity.description?.trim();
    if (briefText && !briefText.startsWith("/")) projectLines.push(briefText);
    // Structured profile — the build-driving fields the operator filled. Without
    // these, "next best" is judged on description + goals alone; with them, the
    // agent knows the stack, architecture, conventions, and what "done" means.
    for (const [key, label] of DRIVING_FIELDS) {
      const v = answer(attrs[key]);
      if (v) projectLines.push(`${label}: ${v}`);
    }
    const notes = runtimeProject?.notes?.trim();
    if (notes) projectLines.push(`Operator notes: ${notes}`);
    const resources = (runtimeProject?.resources ?? [])
      .filter((r) => r.title?.trim() || r.url?.trim() || r.notes?.trim())
      .slice(0, 12);
    if (resources.length > 0) {
      projectLines.push("Resources (docs, datasets, credentials, references):");
      for (const r of resources) {
        const meta = [r.kind, r.url, r.notes].filter(Boolean).join(" — ");
        projectLines.push(`- ${r.title}${meta ? ` (${meta})` : ""}`);
      }
    }
    if (activeGoals.length > 0) {
      projectLines.push("Active goals (the roadmap — aim work at these, highest-impact first):");
      for (const g of activeGoals) {
        const nextMilestone = Array.isArray(g.milestones)
          ? (g.milestones as Milestone[]).find((m) => !m.done)?.title
          : undefined;
        const progress = typeof g.progress === "number" ? ` (${g.progress}%)` : "";
        const next = nextMilestone ? ` — next: ${nextMilestone}` : "";
        projectLines.push(`- ${g.title}${progress}${next}`);
      }
    }
    if (projectLines.length > 0) blocks.push(projectLines.join("\n"));
  }

  return blocks.join("\n\n");
}

/**
 * The goal config that drives the DoD stop-gate for a project: the bar itself
 * (`definition_of_done`) plus the turn cap (`goal_max_turns`) that bounds how
 * many times the loop re-tries before escalating. One attribute fetch.
 */
export async function getProjectGoalConfig(
  userId: string,
  projectKey: string,
): Promise<{ definitionOfDone: string | null; maxTurns: number | null }> {
  const rows = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.type, ENTITY_TYPE.PROJECT)));
  const entity = rows.find((e) => e.name.toLowerCase() === projectKey.toLowerCase());
  if (!entity) return { definitionOfDone: null, maxTurns: null };
  const attrs = (await fetchAttributesByEntityIds([entity.id])).get(entity.id) ?? {};
  const dod = answer(attrs["definition_of_done"]);
  const rawTurns = parseInt(attrs["goal_max_turns"] ?? "", 10);
  // Clamp to a sane range; ignore garbage. An explicit 0 is the escape hatch
  // for "genuinely loop until met" — deliberate, not the accidental default.
  const maxTurns =
    Number.isFinite(rawTurns) && rawTurns > 0
      ? Math.min(rawTurns, 20)
      : rawTurns === 0
        ? null
        : DEFAULT_GOAL_MAX_TURNS;
  return { definitionOfDone: dod, maxTurns };
}

/** The single goal a project is currently aiming at, for at-a-glance UI. */
export type TopGoal = { title: string; progress: number | null };

/**
 * The top active goal per project entity, for the operator to see what each
 * project is aiming at while scanning (e.g. the Loki project panel) — the same
 * roadmap the autopilot reads via getProjectContext, surfaced visually.
 *
 * Keyed by entity id (userProjects.entityProjectId), so callers join by the
 * project's linked entity. One batch query over the user's active goals (no
 * N+1); "top" = most recently updated, matching getProjectContext's ordering.
 */
export async function getTopActiveGoalByProject(userId: string): Promise<Map<string, TopGoal>> {
  const rows = await db
    .select({ entityId: goals.entityId, title: goals.title, progress: goals.progress })
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, GOAL_STATUS.ACTIVE)))
    .orderBy(desc(goals.updatedAt));

  const byEntity = new Map<string, TopGoal>();
  for (const r of rows) {
    // First row per entity wins (rows are newest-first), so each project keeps
    // its most recently touched active goal.
    if (r.entityId && !byEntity.has(r.entityId)) {
      byEntity.set(r.entityId, { title: r.title, progress: r.progress ?? null });
    }
  }
  return byEntity;
}
