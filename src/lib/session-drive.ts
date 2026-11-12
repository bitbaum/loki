/**
 * Whose agent session a caller drives when they name a tab.
 *
 * Sessions are keyed by the account that owns them: a tab is `<owner>/<tab>`
 * on the owner's builder, and every control route reads the caller's own. A
 * project member (a seat) therefore had no session at all: QA's Viewer seat
 * on qa-agent-walk got `{ found: false }` and nothing to type into (QA seat
 * walk, 2026-11-12).
 *
 * The rule (docs/architecture/private-builders.md): whoever asks for a change
 * pays, with their own engine. A seat drives the owner's session only when the
 * owner has said so for that one project (`project_memberships.drives_session`),
 * which is the owner saying they will pay for it. Then, and only then:
 *
 * - the seat reaches that project's OWN tab, named exactly as the project, on
 *   the owner's builder, in the project's own folder;
 * - never another project's tab, never a lane or a shell, and never a tab the
 *   owner has open that is not that project's;
 * - a tab the caller owns is always the caller's own, grant or not.
 *
 * Pure decision here; the database read is in db/queries/session-drive.ts.
 */
import { isShellTab } from "@/lib/shell-session";

export type DriveGrant = { ownerId: string; projectName: string };

export type DriveTarget =
  | { kind: "own"; ownerId: string; tab: string }
  | { kind: "granted"; ownerId: string; tab: string; drivenBy: string };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function decideDriveTarget(input: {
  callerId: string;
  tab: string;
  /** The caller owns a project (or tab) by this name. */
  callerOwnsTab: boolean;
  grants: readonly DriveGrant[];
}): DriveTarget {
  const { callerId, tab } = input;
  if (input.callerOwnsTab) return { kind: "own", ownerId: callerId, tab };
  const grant = input.grants.find((g) => same(g.projectName, tab));
  // A shell is never anyone's but the operator's, whatever it is called.
  if (!grant || isShellTab(tab) || isShellTab(grant.projectName)) {
    return { kind: "own", ownerId: callerId, tab };
  }
  // The project's own tab, spelled as the owner's project is: never the
  // caller's spelling, so a granted name cannot be bent into another tab.
  return { kind: "granted", ownerId: grant.ownerId, tab: grant.projectName, drivenBy: callerId };
}
