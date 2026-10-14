/**
 * A preview's own address, the pure half: which labels may be one and what
 * host and URL they make. No I/O, so the creation flow, the box script's
 * grammar and the tests all read the same rule (host.ts runs the script).
 */
import { RESERVED_SITE_SLUGS } from "@/lib/site-slug";
import { isPreviewSlug } from "@/lib/previews/root";

const BASE_DOMAIN = process.env.SITES_BASE_DOMAIN?.trim() || "orangecat.ch";

/** A preview slug that is not an infrastructure name (`p` is the path prefix). */
export function isPreviewAddress(label: string): boolean {
  return isPreviewSlug(label) && !RESERVED_SITE_SLUGS.has(label) && label !== "p";
}

export const previewHostFor = (label: string) => `${label}.${BASE_DOMAIN}`;
export const previewHostUrl = (label: string) => `https://${previewHostFor(label)}/`;
