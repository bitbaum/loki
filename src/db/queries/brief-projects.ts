import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, userProjects } from "@/db/schema";
import { ENTITY_TYPE } from "@/lib/constants/statuses";

/**
 * Lookups for projects started from a brief (/change, /take).
 *
 * The duplicate-submit guard is the request id kept in the project's metadata
 * (`briefRequestId`) — not its name, which is now the site's own readable name.
 */

/** This user's project already started for this request, if any. */
export async function findBriefProject(
  userId: string,
  requestId: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(
      and(
        eq(entities.userId, userId),
        eq(entities.type, ENTITY_TYPE.PROJECT),
        sql`${entities.metadata}->>'briefRequestId' = ${requestId}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * A name is taken when ANY project in the fleet uses it: the name becomes a
 * GitHub repository in the org and a <name>.orangecat.ch address, both global.
 */
export async function isProjectNameTaken(name: string): Promise<boolean> {
  const lower = name.trim().toLowerCase();
  const [entity] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.type, ENTITY_TYPE.PROJECT), sql`lower(${entities.name}) = ${lower}`))
    .limit(1);
  if (entity) return true;
  const [registered] = await db
    .select({ id: userProjects.id })
    .from(userProjects)
    .where(sql`lower(${userProjects.name}) = ${lower}`)
    .limit(1);
  return Boolean(registered);
}

/** How a brief project began. "repo-copy" (/take) is load-bearing: its kickoff
 *  uses the empty starter and switches the imported repo's Actions off. */
export type BriefKind = "website" | "repo-copy";

/** Record which request started this project (so a repeat resumes it) and how. */
export async function markBriefProject(
  entityId: string,
  requestId: string,
  kind: BriefKind,
): Promise<void> {
  const patch = JSON.stringify({ briefRequestId: requestId, briefKind: kind });
  await db
    .update(entities)
    .set({ metadata: sql`coalesce(${entities.metadata}, '{}'::jsonb) || ${patch}::jsonb` })
    .where(eq(entities.id, entityId));
}

/** The kind recorded at start, or null for a project not started from a brief. */
export async function getBriefKind(entityId: string): Promise<BriefKind | null> {
  const [row] = await db
    .select({ kind: sql<string | null>`${entities.metadata}->>'briefKind'` })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);
  return row?.kind === "repo-copy" || row?.kind === "website" ? row.kind : null;
}
