import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectMemberships, userProjects, users, type ProjectRole } from "@/db/schema";

export type ProjectAccess = {
  role: "owner" | ProjectRole;
  ownerUserId: string;
  canEdit: boolean;
  canManageMembers: boolean;
};

/** One authorization decision for every project surface. Runtime work always
 * executes in the owner's tenant; collaborators receive capabilities, never
 * ownership of the owner's runner credentials. */
export async function getProjectAccess(
  userId: string,
  projectId: string,
): Promise<ProjectAccess | null> {
  const [owned] = await db
    .select({ ownerUserId: userProjects.userId })
    .from(userProjects)
    .where(
      and(
        eq(userProjects.entityProjectId, projectId),
        eq(userProjects.userId, userId),
        eq(userProjects.isActive, true),
      ),
    )
    .limit(1);
  if (owned)
    return { role: "owner", ownerUserId: owned.ownerUserId, canEdit: true, canManageMembers: true };

  const [member] = await db
    .select({ role: projectMemberships.role, ownerUserId: userProjects.userId })
    .from(projectMemberships)
    .innerJoin(
      userProjects,
      and(
        eq(userProjects.entityProjectId, projectMemberships.projectId),
        eq(userProjects.isActive, true),
      ),
    )
    .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)))
    .limit(1);
  if (!member) return null;
  return {
    role: member.role,
    ownerUserId: member.ownerUserId,
    canEdit: member.role === "editor",
    canManageMembers: false,
  };
}

export async function listProjectMembers(projectId: string) {
  return db
    .select({
      id: projectMemberships.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: projectMemberships.role,
    })
    .from(projectMemberships)
    .innerJoin(users, eq(users.id, projectMemberships.userId))
    .where(eq(projectMemberships.projectId, projectId));
}

export async function upsertProjectMember(projectId: string, userId: string, role: ProjectRole) {
  const [row] = await db
    .insert(projectMemberships)
    .values({ projectId, userId, role })
    .onConflictDoUpdate({
      target: [projectMemberships.projectId, projectMemberships.userId],
      set: { role, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function removeProjectMember(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(projectMemberships)
    .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)))
    .returning({ id: projectMemberships.id });
  return rows.length > 0;
}
