/** The rule behind lib/feedback/pass-holder.ts, without the database: pure, so it is tested alone. */

import type { ProjectRole } from "@/db/schema/project-memberships";
import { capabilitiesForRole } from "@/lib/project-capabilities";

export type Site = { projectId: string; userId: string };

/**
 * Who Loki hands a pass to on the project page: the owner and every Builder.
 * A pass is what makes a note on the site build at once instead of waiting
 * for the owner, so this IS the "Builder's feedback goes straight to Loki"
 * rule (owner, 2026-10-17). Viewers and clients get the plain site link, and
 * what they ask for waits for the owner.
 */
export function mayHoldPass(role: "owner" | ProjectRole | null): boolean {
  if (!role) return false;
  return role === "owner" || capabilitiesForRole(role).canEdit;
}

/** Pure: may this verified pass act for this site, given the holder's access? */
export function passAllows(
  pass: { projectId: string; userId: string } | null,
  site: Site,
  holderCanEdit: boolean,
): boolean {
  if (!pass || pass.projectId !== site.projectId) return false;
  return pass.userId === site.userId || holderCanEdit;
}
