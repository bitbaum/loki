/**
 * What a role may do on someone else's project — the rule, on its own.
 *
 * This lived as two expressions inside `getProjectAccess`, which cannot be
 * imported without a DATABASE_URL. So the one authorization decision every
 * project surface reads had no test: the only way to find out that a viewer
 * could edit, or that an editor could add members, was to sign in as one and
 * look. A boundary whose only proof is a manual walk is a boundary that regains
 * a hole the first time someone adds a role.
 *
 * Pure and exhaustive, so adding a role to PROJECT_ROLE_VALUES without deciding
 * its capabilities is a type error rather than a silent `false`.
 *
 * The rule itself is unchanged, and deliberately narrow: runtime work always
 * executes in the OWNER's tenant, so a collaborator receives capabilities, never
 * ownership of the owner's runner credentials.
 */

import type { ProjectRole } from "@/db/schema/project-memberships";

export type ProjectCapabilities = {
  /** Change the project: notes, prefs, dispatching work against it. */
  canEdit: boolean;
  /** Invite, promote or remove collaborators. Owner-only. */
  canManageMembers: boolean;
};

/** The owner of the project. Everything, including the member list. */
export const OWNER_CAPABILITIES: ProjectCapabilities = {
  canEdit: true,
  canManageMembers: true,
};

/**
 * Exhaustive by construction: a Record over ProjectRole, so a new role must be
 * given capabilities here or the build fails. A missing entry defaulting to
 * "no" would be safe, but silently; a missing entry defaulting to a COPY of
 * another role would not be safe at all, and both are how a permission table
 * drifts from the roles it is supposed to describe.
 */
const MEMBER_CAPABILITIES: Record<ProjectRole, ProjectCapabilities> = {
  // An editor works the project but never changes who else can reach it.
  // Membership is the owner's decision about their own tenant.
  editor: { canEdit: true, canManageMembers: false },
  // A viewer reads. This is the role a reporter is given on a project they
  // filed against, so "can look at the fix, cannot dispatch another one".
  viewer: { canEdit: false, canManageMembers: false },
};

export function capabilitiesForRole(role: "owner" | ProjectRole): ProjectCapabilities {
  return role === "owner" ? OWNER_CAPABILITIES : MEMBER_CAPABILITIES[role];
}
