/**
 * Who may act as the site's owner in its widget: the owner, and only the
 * owner. The owner pass is the owner's console — a note sent with it starts
 * a build on the owner's builder and engine, so it names the one person
 * whose word that is.
 *
 * From 2026-10-16 to 2026-10-20 it was also honoured for editors, so that a
 * Builder on the site was not a stranger. That spent the owner's engine on
 * the Builder's word. Everyone with a seat now carries a MEMBER pass instead
 * (member-pass.ts): the ordinary panel, their notes filed as theirs, and the
 * owner decides (ask-in-loki.ts).
 */
import { getProjectAccess, type ProjectAccess } from "@/db/queries/project-access";
import { verifyMemberPass } from "./member-pass";
import { verifyOwnerPass } from "./owner-pass";

import { passAllows, type Site } from "./pass-rule";

export { passAllows };

/** May `userId` act as the owner on this site? (Issuing a pass.) */
export function canActForSite(userId: string, site: Site): boolean {
  return userId === site.userId;
}

/** The pass's holder when it may act for this site, else null. A signature
 *  check, no database. */
export function passHolder(raw: string | null | undefined, site: Site): { userId: string } | null {
  const pass = raw ? verifyOwnerPass(raw) : null;
  if (!pass || pass.projectId !== site.projectId) return null;
  return passAllows(pass, site, canActForSite(pass.userId, site)) ? { userId: pass.userId } : null;
}

/**
 * The member a member pass names (member-pass.ts), with their seat as it is
 * NOW: removing someone from the project ends what their pass can do at once.
 */
export async function passMember(
  raw: string | null | undefined,
  projectId: string,
): Promise<{ userId: string; access: ProjectAccess } | null> {
  const named = verifyMemberPass(raw, projectId);
  if (!named) return null;
  const access = await getProjectAccess(named.userId, projectId).catch(() => null);
  return access ? { userId: named.userId, access } : null;
}
