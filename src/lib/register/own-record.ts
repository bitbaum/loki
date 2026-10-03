import { loadFleetMap } from "@/lib/register/load-map";
import type { FleetMapEntry } from "@/lib/register/map";

/**
 * Loki's own entry on the fleet map, for its /roadmap and /changelog pages.
 *
 * Same producer as every other site's pages: ROADMAP.md and CHANGELOG.md in
 * this repository, read into the map (repo-records.ts). Loki reads the map
 * in-process instead of over HTTP because it IS the producer; the shape and
 * the rule are identical, and a local copy of either record is exactly what
 * docs/architecture/building-in-public-ssot.md forbids.
 */
export const OWN_SLUG = "loki";

export async function ownRecord(): Promise<{ entry: FleetMapEntry; readAt: string } | null> {
  try {
    const map = await loadFleetMap();
    const entry = map?.projects.find((p) => p.slug === OWN_SLUG);
    return map && entry ? { entry, readAt: map.generatedAt } : null;
  } catch {
    return null;
  }
}
