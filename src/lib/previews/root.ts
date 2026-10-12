/**
 * Where prospect previews live on disk, and what counts as one.
 *
 * fs/path only (no database), because the dispatch lock in
 * execution-access.ts reads it and that module ships into the desktop bundle.
 */
import path from "path";
import { PREVIEWS } from "@/config/previews";

/**
 * The folder that holds every preview, or null when this deployment has none.
 *
 * Explicit env first. Otherwise inside the box's clone root, and only when
 * that root is set explicitly: the default `~/dev` on a laptop is the
 * laptop's own tree, and previews must never be created there by a dev server.
 */
export function previewsRoot(): string | null {
  const explicit = process.env.LOKI_PREVIEWS_ROOT?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const boxRoot = process.env.LOKI_BOX_DEV_ROOT?.trim().replace(/\/+$/, "");
  return boxRoot ? path.join(boxRoot, "previews") : null;
}

const SLUG = new RegExp(`^[a-z0-9](?:[a-z0-9-]{0,${PREVIEWS.maxSlugLength - 2}}[a-z0-9])?$`);

/** A folder name a preview may have: lowercase letters, digits, inner dashes. */
export function isPreviewSlug(value: string): boolean {
  return SLUG.test(value);
}

/** "Francesco Tarallo" → "francesco-tarallo"; "Café Zürich" → "cafe-zurich". */
export function slugifyPreviewName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PREVIEWS.maxSlugLength)
    .replace(/-+$/g, "");
  return slug || "preview";
}

/** The folder of one preview, or null when previews are off or the slug is bad. */
export function previewDirFor(slug: string): string | null {
  const root = previewsRoot();
  if (!root || !isPreviewSlug(slug)) return null;
  return path.join(root, slug);
}

/** Is this project directory a preview folder? (Then it builds on the box.) */
export function isPreviewDir(dirPath: string | null | undefined): boolean {
  const root = previewsRoot();
  if (!root || !dirPath) return false;
  const rel = path.relative(root, dirPath);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel) && isPreviewSlug(rel);
}
