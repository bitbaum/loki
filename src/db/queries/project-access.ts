import { projectTitle } from "@/lib/project-display";
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
import { requireNotDemo } from "@/lib/demo-guard";

export type ProjectAccess = {
  role: "owner" | ProjectRole;
  ownerUserId: string;
  canEdit: boolean;
  canManageMembers: boolean;
};

/** One authorization decision for every project surface. Collaborators
 * receive capabilities, never the owner's builder: a seat's ask is a
 * suggestion to the owner until the seat has a builder of its own
 * (lib/feedback/ask-in-loki.ts, docs/architecture/private-builders.md). */
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
    .select({
      role: projectMemberships.role,
      ownerUserId: userProjects.userId,
    })
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

/**
 * The projects someone else shared with this person, with what Loki needs to
 * tell them how to change each one: who owns it, as what they were added,
 * and where it lives. Today, Control and the chat read it, so a Builder who
 * owns nothing is never told to "add a project" or install anything — the
 * project they were invited to IS their way in (walk as Manu, 2026-10-18).
 */
export async function listSharedProjects(userId: string): Promise<SharedProject[]> {
  const rows = await db
    .select({
      projectId: entities.id,
      name: entities.name,
      title: entities.title,
      description: entities.description,
      role: projectMemberships.role,
      ownerName: users.name,
      liveUrl: userProjects.liveUrl,
    })
    .from(projectMemberships)
    .innerJoin(entities, eq(entities.id, projectMemberships.projectId))
    .innerJoin(users, eq(users.id, entities.userId))
    .innerJoin(
      userProjects,
      and(
        eq(userProjects.entityProjectId, entities.id),
        eq(userProjects.userId, entities.userId),
        eq(userProjects.isActive, true),
      ),
    )
    .where(eq(projectMemberships.userId, userId))
    .orderBy(entities.name);
  // The name a person reads (projectTitle), never the key the owner's flow minted.
  return rows.map(({ title, description, ...row }) => ({
    ...row,
    name: projectTitle({ name: row.name, title, description }),
  }));
}

export type SharedProject = {
  projectId: string;
  name: string;
  role: ProjectRole;
  ownerName: string | null;
  liveUrl: string | null;
};

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
  /** Null: an open link (lib/project-invites). */
  email: string | null;
  role: ProjectRole;
  invitedBy: string;
}): Promise<{ invitation: ProjectInvitation; token: string }> {
  // The demo account is every visitor at once: an invite from it would let
  // anyone seat themselves on the demo's projects, in front of the next visitor.
  await requireNotDemo(input.invitedBy, "tenancy");
  const email = input.email ? normalizeInviteEmail(input.email) : null;
  // One live invite per (project, email): re-inviting replaces the old link
  // rather than leaving two valid ones that each grant access. Open links are
  // each their own seat — inviting two people takes two links.
  if (email)
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
      expiresAt: inviteExpiry(new Date(), email === null),
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
      projectTitle: entities.title,
      // What the project is and where it lives: the invite page says both,
      // so the person decides from the page instead of asking back.
      projectDescription: entities.description,
      liveUrl: userProjects.liveUrl,
      inviterName: users.name,
    })
    .from(projectInvitations)
    .innerJoin(entities, eq(entities.id, projectInvitations.projectId))
    .innerJoin(users, eq(users.id, projectInvitations.invitedBy))
    .leftJoin(
      userProjects,
      and(
        eq(userProjects.entityProjectId, entities.id),
        eq(userProjects.userId, entities.userId),
        eq(userProjects.isActive, true),
      ),
    )
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
  // And the reverse: every visitor holding someone's project through the demo.
  await requireNotDemo(userId, "tenancy");
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

export type TransferRefusal = "not_owner" | "not_a_member" | "same_person";

/**
 * Hand a project to one of its members.
 *
 * Ownership is the user_projects row (the tenant the work runs in), so a
 * transfer moves that row to the new owner, gives the old owner a builder's
 * seat so they are not locked out of what they just handed over, and drops
 * the new owner's membership row (an owner is not also a member). One
 * transaction: a project is never ownerless, and never has two owners.
 * The studio's hand-over to a client is this call.
 */
export async function transferProjectOwnership(
  projectId: string,
  fromUserId: string,
  toUserId: string,
): Promise<{ ok: true } | { ok: false; refusal: TransferRefusal }> {
  if (fromUserId === toUserId) return { ok: false, refusal: "same_person" };
  const access = await getProjectAccess(fromUserId, projectId);
  if (!access || access.role !== "owner") return { ok: false, refusal: "not_owner" };
  const [member] = await db
    .select({ id: projectMemberships.id })
    .from(projectMemberships)
    .where(
      and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, toUserId)),
    )
    .limit(1);
  if (!member) return { ok: false, refusal: "not_a_member" };

  await db.transaction(async (tx) => {
    await tx
      .update(userProjects)
      .set({ userId: toUserId })
      .where(and(eq(userProjects.entityProjectId, projectId), eq(userProjects.userId, fromUserId)));
    await tx
      .delete(projectMemberships)
      .where(
        and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, toUserId)),
      );
    await tx
      .insert(projectMemberships)
      .values({ projectId, userId: fromUserId, role: "editor" })
      .onConflictDoUpdate({
        target: [projectMemberships.projectId, projectMemberships.userId],
        set: { role: "editor", updatedAt: new Date() },
      });
  });
  return { ok: true };
}

/** What a project is called and says it is, for mail and pages that name it. */
export async function getProjectNaming(projectId: string) {
  const [row] = await db
    .select({ name: entities.name, title: entities.title, description: entities.description })
    .from(entities)
    .where(eq(entities.id, projectId))
    .limit(1);
  return row ?? null;
}
