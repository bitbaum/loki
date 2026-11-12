import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, projectMemberships, userProjects } from "@/db/schema";
import { decideDriveTarget, type DriveGrant, type DriveTarget } from "@/lib/session-drive";

/** The projects whose own session this member may drive (lib/session-drive.ts). */
export async function listDriveGrants(userId: string): Promise<DriveGrant[]> {
  return db
    .select({ ownerId: entities.userId, projectName: userProjects.name })
    .from(projectMemberships)
    .innerJoin(entities, eq(entities.id, projectMemberships.projectId))
    .innerJoin(
      userProjects,
      and(
        eq(userProjects.entityProjectId, entities.id),
        eq(userProjects.userId, entities.userId),
        eq(userProjects.isActive, true),
      ),
    )
    .where(
      and(
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.drivesSession, true),
        eq(entities.type, "project"),
      ),
    );
}

/** Whose session a caller drives when naming `tab`: their own, or a granted project's. */
export async function resolveDriveTarget(callerId: string, tab: string): Promise<DriveTarget> {
  const [owned] = await db
    .select({ id: userProjects.id })
    .from(userProjects)
    .where(and(eq(userProjects.userId, callerId), sql`lower(${userProjects.name}) = lower(${tab})`))
    .limit(1);
  const grants = owned ? [] : await listDriveGrants(callerId).catch(() => []);
  return decideDriveTarget({ callerId, tab, callerOwnsTab: Boolean(owned), grants });
}
