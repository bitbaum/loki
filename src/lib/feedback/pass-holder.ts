/**
 * Who may act as the site's owner in its widget: the owner, and anyone they
 * shared the project with as an editor.
 *
 * The pass used to be honoured only for the one account that owns the
 * widget's project. Editors can already triage and build that project's
 * feedback inside Loki (lib/project-capabilities.ts), but on the site itself
 * they were strangers — "sign in" sent them back with "this site belongs to
 * another account", and a client added to their own project could not use
 * Watch, Review or Build there (operator, 2026-10-16). Same rule both places
 * now: whoever `canEdit` the project. Builds still run in the owner's tenant
 * (startOwnerBuild takes the token's owner), exactly as Implement does in Loki.
 */
import { getProjectAccess } from "@/db/queries/project-access";
import { verifyOwnerPass } from "./owner-pass";

import { passAllows, type Site } from "./pass-rule";

export { passAllows };

/** May `userId` act as the owner on this site? (Issuing a pass.) */
export async function canActForSite(userId: string, site: Site): Promise<boolean> {
  if (userId === site.userId) return true;
  const access = await getProjectAccess(userId, site.projectId).catch(() => null);
  return access?.canEdit === true;
}

/**
 * The pass's holder when it may act for this site, else null. Reads the
 * database only for a pass that is NOT the owner's own — the common case
 * stays a signature check.
 */
export async function passHolder(
  raw: string | null | undefined,
  site: Site,
): Promise<{ userId: string } | null> {
  const pass = raw ? verifyOwnerPass(raw) : null;
  if (!pass || pass.projectId !== site.projectId) return null;
  if (pass.userId === site.userId) return { userId: pass.userId };
  return passAllows(pass, site, await canActForSite(pass.userId, site))
    ? { userId: pass.userId }
    : null;
}
