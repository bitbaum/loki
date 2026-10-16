/** The rule behind lib/feedback/pass-holder.ts, without the database: pure, so it is tested alone. */

export type Site = { projectId: string; userId: string };

/** Pure: may this verified pass act for this site, given the holder's access? */
export function passAllows(
  pass: { projectId: string; userId: string } | null,
  site: Site,
  holderCanEdit: boolean,
): boolean {
  if (!pass || pass.projectId !== site.projectId) return false;
  return pass.userId === site.userId || holderCanEdit;
}
