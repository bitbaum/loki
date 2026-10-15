import type { FleetMap, FleetMapEntry } from "@/lib/register/map";

/**
 * Client work the client has NOT agreed to show. It stays in the portfolio —
 * the studio built it — but only behind the operator's access code, on the
 * studio site's private area. Consented client work is on the public map and
 * is not repeated here.
 */
export type PrivatePortfolioEntry = Pick<
  FleetMapEntry,
  "slug" | "name" | "what" | "status" | "since"
> & { live: string | null };

export function privatePortfolio(map: FleetMap): PrivatePortfolioEntry[] {
  return map.projects
    .filter((p) => p.client !== null && !p.client.consentedAt)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      what: p.what,
      status: p.status,
      since: p.since,
      // A live client site sits behind its own code; linking to it is fine.
      // The repo URL is not carried: a client's code is not a visitor's.
      live: p.urls.live,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
