/**
 * Client work and the client's consent: the one rule every public surface
 * follows before it shows a project.
 *
 * Client work is anything built for a real person or organisation, paid or
 * not: a hosted client site, a pilot, a prospect preview. It is the client's
 * before it is ours to show. So it appears on a public surface (the fleet
 * map, /api/fleet/register, /fleet, the bitbaum portfolio, the public chat,
 * /u/<owner>, the footer) only once the client has agreed, and that agreement
 * is recorded on the project (user_projects.portfolio_consent_at), with how it
 * was given. Our own products are unaffected.
 *
 * Pure: no I/O. Callers pass the project's stored answer and its hosting row.
 */

/** Owners that mean "ours", not a client. Everything else is a third party. */
export const OWN_OWNERS: ReadonlySet<string> = new Set(["bitbaum", "-", ""]);

/** apps.conf kinds that are work for someone else, whoever owns the row. */
export const CLIENT_KINDS: ReadonlySet<string> = new Set(["client-app", "client-site"]);

export type HostingFacts = { kind?: string | null; owner?: string | null } | null | undefined;

/** Does the hosting register say this is someone else's? */
export function hostingSaysClient(site: HostingFacts): boolean {
  if (!site) return false;
  const kind = site.kind?.trim().toLowerCase() ?? "";
  const owner = site.owner?.trim().toLowerCase() ?? "";
  return CLIENT_KINDS.has(kind) || !OWN_OWNERS.has(owner);
}

/**
 * Is this client work? The operator's explicit answer wins (true or false);
 * otherwise the hosting register decides; otherwise it is ours.
 */
export function isClientWork(explicit: boolean | null | undefined, site: HostingFacts): boolean {
  if (explicit === true || explicit === false) return explicit;
  return hostingSaysClient(site);
}

/** The consent timestamp as an ISO string, or null. */
export function consentIso(at: Date | string | null | undefined): string | null {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * May this be shown publicly at all? Our own work: yes (each surface still
 * applies its own listing rules). Client work: only with recorded consent.
 */
export function mayShowPublicly(clientWork: boolean, consentAt: Date | string | null | undefined) {
  return !clientWork || consentIso(consentAt) !== null;
}
