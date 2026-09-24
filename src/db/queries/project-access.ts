import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  entities,
  projectInvitations,
  projectMemberships,
  userProjects,
  users,
  type ProjectInvitation,
  type ProjectRole,
} from "@/db/schema";
import {
  hashInviteToken,
  inviteExpiry,
  newInviteToken,
  normalizeInviteEmail,
} from "@/lib/project-invites";
import { capabilitiesForRole, OWNER_CAPABILITIES } from "@/lib/project-capabilities";

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
  if (owned) return { role: "owner", ownerUserId: owned.ownerUserId, ...OWNER_CAPABILITIES };

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
    ...capabilitiesForRole(member.role),
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

// ── Invitations into one project ─────────────────────────────────────────────
// Storage only. Whether an invite may be accepted is decided by the pure
// evaluateInviteAcceptance in lib/project-invites, so the rule has tests.

/** Issue an invite and return the raw token — the only time it exists. */
export async function createProjectInvitation(input: {
  projectId: string;
  email: string;
  role: ProjectRole;
  invitedBy: string;
}): Promise<{ invitation: ProjectInvitation; token: string }> {
  const email = normalizeInviteEmail(input.email);
  // One live invite per (project, email): re-inviting replaces the old link
  // rather than leaving two valid ones that each grant access.
  await db
    .update(projectInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(projectInvitations.projectId, input.projectId),
        eq(projectInvitations.email, email),
        isNull(projectInvitations.acceptedAt),
        isNull(projectInvitations.revokedAt),
      ),
    );
  const token = newInviteToken();
  const [invitation] = await db
    .insert(projectInvitations)
    .values({
      projectId: input.projectId,
      email,
      role: input.role,
      tokenHash: hashInviteToken(token),
      invitedBy: input.invitedBy,
      expiresAt: inviteExpiry(),
    })
    .returning();
  return { invitation, token };
}

/** Load an invite by its raw token, with the project's name for the page. */
export async function getProjectInvitationByToken(token: string) {
  const [row] = await db
    .select({
      invitation: projectInvitations,
      projectName: entities.name,
      inviterName: users.name,
    })
    .from(projectInvitations)
    .innerJoin(entities, eq(entities.id, projectInvitations.projectId))
    .innerJoin(users, eq(users.id, projectInvitations.invitedBy))
    .where(eq(projectInvitations.tokenHash, hashInviteToken(token)))
    .limit(1);
  return row ?? null;
}

/** Invites still waiting to be accepted, for the owner's members panel. */
export async function listPendingProjectInvitations(projectId: string) {
  return db
    .select({
      id: projectInvitations.id,
      email: projectInvitations.email,
      role: projectInvitations.role,
      expiresAt: projectInvitations.expiresAt,
      createdAt: projectInvitations.createdAt,
    })
    .from(projectInvitations)
    .where(
      and(
        eq(projectInvitations.projectId, projectId),
        isNull(projectInvitations.acceptedAt),
        isNull(projectInvitations.revokedAt),
        gt(projectInvitations.expiresAt, new Date()),
      ),
    );
}

export async function revokeProjectInvitation(projectId: string, invitationId: string) {
  const rows = await db
    .update(projectInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(projectInvitations.id, invitationId),
        eq(projectInvitations.projectId, projectId),
        isNull(projectInvitations.acceptedAt),
      ),
    )
    .returning({ id: projectInvitations.id });
  return rows.length > 0;
}

/**
 * Grant the membership and spend the invite, atomically.
 *
 * The `acceptedAt IS NULL AND revokedAt IS NULL` guard on the update is what
 * makes a double click, or two tabs, grant exactly once: the second attempt
 * updates nothing and reports that the invite was already used.
 */
export async function acceptProjectInvitation(
  invitationId: string,
  userId: string,
): Promise<{ projectId: string } | null> {
  return db.transaction(async (tx) => {
    const [spent] = await tx
      .update(projectInvitations)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(
        and(
          eq(projectInvitations.id, invitationId),
          isNull(projectInvitations.acceptedAt),
          isNull(projectInvitations.revokedAt),
        ),
      )
      .returning({ projectId: projectInvitations.projectId, role: projectInvitations.role });
    if (!spent) return null;
    await tx
      .insert(projectMemberships)
      .values({ projectId: spent.projectId, userId, role: spent.role })
      .onConflictDoUpdate({
        target: [projectMemberships.projectId, projectMemberships.userId],
        set: { role: spent.role, updatedAt: new Date() },
      });
    return { projectId: spent.projectId };
  });
}
