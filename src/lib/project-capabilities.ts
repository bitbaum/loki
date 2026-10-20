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
  // The client is who the project is for. They cannot edit the project; what
  // they ask for goes to the owner, who decides (feedback/ask-in-loki.ts). A
  // change built for them opens as a draft and goes live on their own "Make
  // it live" (feedback/go-live.ts).
  client: { canEdit: false, canManageMembers: false },
  // A viewer reads. This is the role a reporter is given on a project they
  // filed against, so "can look at the fix, cannot dispatch another one".
  viewer: { canEdit: false, canManageMembers: false },
};

/**
 * What each role is called and does, in the words the roster shows. One
 * table, read by the members panel, the invite page and the invite email, so
 * the label a person is invited under is the label they see once inside.
 *
 * Written for someone who is not technical (the first Builder invited was a
 * doctor, 2026-10-17): no "dispatch", no "agents", no "tenant". The one
 * thing each role needs to know is what happens to what they ask for.
 */
export const ROLE_LABELS: Record<
  "owner" | ProjectRole,
  {
    label: string;
    /** For the owner choosing a role. Starts with the label. */
    help: string;
    /** "…so you can {can}" in the invitation. */
    can: string;
  }
> = {
  owner: {
    label: "Owner",
    help: "Owner: runs the project and decides who else is on it.",
    can: "run it as your own",
  },
  editor: {
    label: "Builder",
    help: "Builder: works on the project with you and sees everything. What they ask for comes to you first; once they have a builder of their own, they build it themselves.",
    can: "work on it with them: see everything and say what should change",
  },
  client: {
    label: "Client",
    help: "Client: the person the site is for. What they ask for comes to you first, and they see every change.",
    can: "follow it as its client: say what it needs and see every change",
  },
  viewer: {
    label: "Viewer",
    help: "Viewer: sees everything. What they ask for comes to you first.",
    can: "follow it: see what is being built and say what you need",
  },
};

/**
 * The manual, three lines long: how a person on the project asks for a change
 * and what happens next. The invite page shows it before they join and the
 * project shows it after, so nobody has to be told twice or ask.
 */
export function roleGuide(
  role: ProjectRole,
  names: { site: string | null; owner: string },
): { steps: string[]; then: string } {
  const site = names.site ?? "the site";
  // Two doors, one outcome. Until 2026-10-18 the site was the only one, and
  // the orange "Ask Loki" on the project opened a chat that told a Builder to
  // edit HTML on a computer with the desktop app (walk as Manu).
  const steps = [
    `Write it on this project's page in Loki, or open ${site} and tap Feedback in the corner.`,
    "Say what should change — type it or speak it. On the site you can also point at the spot.",
  ];
  // The same promise for every seat: whoever asks pays, in their own builder,
  // and a seat is not the owner's engine. Until 2026-10-20 a Builder was told
  // "nothing waits for them" and built on the owner's subscription.
  void role;
  const then = `${names.owner} sees it first and decides. You are told when it ships.`;
  return { steps, then };
}

export function capabilitiesForRole(role: "owner" | ProjectRole): ProjectCapabilities {
  return role === "owner" ? OWNER_CAPABILITIES : MEMBER_CAPABILITIES[role];
}

/** Where a person on someone else's project asks for a change in Loki. */
export function askPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}#ask`;
}

/**
 * What the person is told once their ask is sent from Loki — the same promise
 * the guide made, kept: the owner's ask is being built, anyone else's is with
 * the owner. A build that could not start says why, in the build's own words.
 */
export function askReply(
  role: "owner" | ProjectRole,
  outcome: { owner: string; site: string | null; building: boolean; buildNote?: string | null },
): string {
  if (role !== "owner")
    return `Sent to ${outcome.owner}. They decide, and you are told when it ships.`;
  if (outcome.building) {
    const where = outcome.site ? ` on ${outcome.site}` : "";
    return `Loki is building it now. You will see it${where} when it is live.`;
  }
  return (
    outcome.buildNote?.trim() ||
    "Saved, but it could not start yet. It waits in Loki under Feedback."
  );
}

/**
 * One line per shared project for Loki's chat, so "make the heading bigger"
 * from a Builder who owns nothing is answered with where to ask — never with
 * "install the desktop app", which is what it said before (2026-10-18).
 */
export function sharedProjectLine(
  p: { name: string; role: ProjectRole; ownerName: string | null; liveUrl: string | null },
  askUrl: string,
): string {
  const owner = p.ownerName?.trim() || "its owner";
  const label = ROLE_LABELS[p.role].label;
  const site = p.liveUrl ? ` or with Feedback on ${p.liveUrl}` : "";
  return `${p.name} — shared by ${owner}, you are its ${label}. To change it: write it at ${askUrl}${site}. ${owner} decides.`;
}
