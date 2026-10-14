/**
 * Storage for the kickoff's "Built from" plan (src/lib/kit-plan): the plan on
 * the project row, and the planned-vs-observed record on the kickoff run.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orchestrationRuns } from "@/db/schema/orchestration-runs";
import { userProjects } from "@/db/schema/user-projects";
import type { KitPlanRecord, KitRunRecord } from "@/lib/kit-plan/types";

/** Record the plan the first build was briefed with. */
export async function setProjectKitPlan(
  userId: string,
  userProjectId: string,
  plan: KitPlanRecord,
): Promise<void> {
  await db
    .update(userProjects)
    .set({ kitPlan: plan, updatedAt: new Date() })
    .where(and(eq(userProjects.id, userProjectId), eq(userProjects.userId, userId)));
}

export type KitRun = { id: string; finishedAt: Date | null; record: KitRunRecord };

/** The newest run of this project that carries a kit plan — its kickoff. */
export async function getLatestKitRun(
  userId: string,
  entityProjectId: string,
): Promise<KitRun | null> {
  const [row] = await db
    .select({
      id: orchestrationRuns.id,
      finishedAt: orchestrationRuns.finishedAt,
      record: sql<KitRunRecord>`${orchestrationRuns.payload}->'kitPlan'`,
    })
    .from(orchestrationRuns)
    .where(
      and(
        eq(orchestrationRuns.userId, userId),
        eq(orchestrationRuns.projectId, entityProjectId),
        sql`${orchestrationRuns.payload} ? 'kitPlan'`,
      ),
    )
    .orderBy(desc(orchestrationRuns.startedAt))
    .limit(1);
  return row && Array.isArray(row.record?.planned) ? row : null;
}
