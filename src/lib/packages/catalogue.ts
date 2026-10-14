/**
 * The fleet's shared packages, as the Packages pages see them.
 *
 * Served from the fleet brief's one read of bitbaum/fleet
 * `registers/packages.json` (src/lib/fleet-brief/brief.ts → getFleetFacts):
 * live with a 15-minute cache and a 2-second timeout, falling back to the
 * committed snapshot. This module adds no fetch of its own — see
 * ./catalogue-parse.ts for why there is exactly one.
 */
import { getFleetFacts } from "@/lib/fleet-brief/brief";
import { SLUG_RE, type CataloguePackage } from "./catalogue-parse";

export type { CataloguePackage } from "./catalogue-parse";

export type PackageCatalogue = {
  packages: CataloguePackage[];
  /** Live from fleet, or the committed snapshot because fleet did not answer. */
  source: "live" | "snapshot";
  /** When fleet generated the register (null when it did not say). */
  registerGeneratedAt: string | null;
};

/** Never throws: the worst case is the snapshot, and the worst snapshot is empty. */
export async function getPackageCatalogue(): Promise<PackageCatalogue> {
  try {
    const facts = await getFleetFacts();
    return {
      packages: facts.catalogue,
      source: facts.source.packages,
      registerGeneratedAt: facts.registerGeneratedAt,
    };
  } catch {
    return { packages: [], source: "snapshot", registerGeneratedAt: null };
  }
}

/** One package by its slug, or null when the register does not list it. */
export function findCataloguePackage(
  catalogue: readonly CataloguePackage[],
  slug: string,
): CataloguePackage | null {
  return catalogue.find((pkg) => pkg.slug === slug) ?? null;
}

/** One package by a slug from a URL — refused before any lookup when it is not slug-shaped. */
export async function getCataloguePackageBySlug(slug: string): Promise<CataloguePackage | null> {
  if (!SLUG_RE.test(slug)) return null;
  return findCataloguePackage((await getPackageCatalogue()).packages, slug);
}
