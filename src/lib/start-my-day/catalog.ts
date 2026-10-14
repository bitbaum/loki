import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, projectMemberships, userProjects, users } from "@/db/schema";
import { getOrgPeerIds } from "@/db/queries/utils";
import { getProjectAccess } from "@/db/queries/project-access";
import { readDayPreferences, type DayPreferences } from "./preferences";

/** Same owned, explicit membership and org visibility as the project directory.
 * Org visibility alone does not confer permission to spend an owner's runner. */
export async function getDayCatalog(userId: string) {
  const peers = await getOrgPeerIds(userId);
  const memberships = await db
    .select({ id: projectMemberships.projectId })
    .from(projectMemberships)
    .where(eq(projectMemberships.userId, userId));
  const ids = memberships.map((m) => m.id);
  const rows = await db
    .select({ project: userProjects, displayName: entities.name })
    .from(userProjects)
    .leftJoin(entities, eq(entities.id, userProjects.entityProjectId))
    .where(
      and(
        eq(userProjects.isActive, true),
        or(
          inArray(userProjects.userId, [userId, ...peers]),
          ...(ids.length ? [inArray(userProjects.entityProjectId, ids)] : []),
        ),
      ),
    );
  return Promise.all(
    rows.map(async ({ project, displayName }) => {
      const access =
        project.userId === userId
          ? { canEdit: true, role: "owner" as const }
          : project.entityProjectId
            ? await getProjectAccess(userId, project.entityProjectId)
            : null;
      return {
        ...project,
        displayName: displayName || project.name,
        canStart: Boolean(access?.canEdit),
        role: access?.role ?? "viewer",
      };
    }),
  );
}

export async function getDayPreferences(userId: string) {
  const [user] = await db
    .select({ settings: users.fleetSettings })
    .from(users)
    .where(eq(users.id, userId));
  return readDayPreferences(user?.settings.startMyDay);
}

export async function saveDayPreferences(userId: string, preferences: DayPreferences) {
  // Atomic one-key merge, so other account settings cannot be overwritten.
  await db
    .update(users)
    .set({
      fleetSettings: sql`jsonb_set(${users.fleetSettings}, '{startMyDay}', ${JSON.stringify(preferences)}::jsonb, true)`,
    })
    .where(eq(users.id, userId));
}
