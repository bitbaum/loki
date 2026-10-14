/**
 * A preview's own address, the pure half: which labels may be one and what
 * host and URL they make. No I/O, so the creation flow, the box script's
 * grammar and the tests all read the same rule (host.ts runs the script).
 */
import { sitesBaseDomain } from "@/lib/site-cd";
import { RESERVED_SITE_SLUGS } from "@/lib/site-slug";
import { isPreviewSlug } from "@/lib/previews/root";

/** A preview slug that is not an infrastructure name (`p` is the path prefix). */
export function isPreviewAddress(label: string): boolean {
  return isPreviewSlug(label) && !RESERVED_SITE_SLUGS.has(label) && label !== "p";
}

export const previewHostFor = (label: string) => `${label}.${sitesBaseDomain()}`;
export const previewHostUrl = (label: string) => `https://${previewHostFor(label)}/`;
