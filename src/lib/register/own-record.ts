import { loadFleetMap } from "@/lib/register/load-map";
import type { FleetMapEntry, MapRoadmapItem } from "@/lib/register/map";

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

/** Roadmap items grouped the way a reader asks: what works, what is next, what is later. */
export const ROADMAP_GROUPS: ReadonlyArray<{ status: string; title: string; summary: string }> = [
  {
    status: "in progress",
    title: "Now",
    summary: "Being built now. Ticked steps are done and in use.",
  },
  {
    status: "planned",
    title: "Next",
    summary:
      "Concrete engineering, in sequence. Ticked steps are done; the rest is not available yet.",
  },
  {
    status: "later",
    title: "Later",
    summary: "Directions we are committed to that are design and strategy work today.",
  },
  { status: "done", title: "Shipped", summary: "Delivered and in use." },
];

export function groupRoadmap(
  items: MapRoadmapItem[],
): Array<{ status: string; title: string; summary: string; items: MapRoadmapItem[] }> {
  const known = new Set(ROADMAP_GROUPS.map((g) => g.status));
  const groups = ROADMAP_GROUPS.map((g) => ({
    ...g,
    items: items.filter((i) => (i.status ?? "planned") === g.status),
  }));
  const other = items.filter((i) => !known.has(i.status ?? "planned"));
  if (other.length) groups.push({ status: "other", title: "Also", summary: "", items: other });
  return groups.filter((g) => g.items.length > 0);
}
