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
  // The client is who the project is for. They follow it and see every fix,
  // and they are the person the builder answers to — but they do not spend
  // the owner's runner. Same capabilities as a viewer; a different name,
  // because a roster that cannot say who is paying is not a roster.
  client: { canEdit: false, canManageMembers: false },
  // A viewer reads. This is the role a reporter is given on a project they
  // filed against, so "can look at the fix, cannot dispatch another one".
  viewer: { canEdit: false, canManageMembers: false },
};

/**
 * What each role is called and does, in the words the roster shows. One
 * table, read by the members panel and the invite email, so the label a
 * person is invited under is the label they see once inside.
 */
export const ROLE_LABELS: Record<
  "owner" | ProjectRole,
  { label: string; help: string; /** "…so you can {can}" in the invitation. */ can: string }
> = {
  owner: {
    label: "Owner",
    help: "Owner: runs the project in their own tenant and decides who else can reach it.",
    can: "run it as your own",
  },
  editor: {
    label: "Builder",
    help: "Builder: can run agents, triage and implement feedback, edit notes and settings.",
    can: "work on it with them: run agents, edit notes and settings",
  },
  client: {
    label: "Client",
    help: "Client: the person the project is for — follows it and every fix, cannot dispatch work.",
    can: "follow it as its client: see every run, every fix and what shipped, and say what you need next",
  },
  viewer: {
    label: "Viewer",
    help: "Viewer: can follow the project and its feedback, but cannot dispatch work.",
    can: "follow it: see its runs, feedback and what shipped",
  },
};

export function capabilitiesForRole(role: "owner" | ProjectRole): ProjectCapabilities {
  return role === "owner" ? OWNER_CAPABILITIES : MEMBER_CAPABILITIES[role];
}
