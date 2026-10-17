/**
 * Where the tour's pictures live: `.loki/pictures/<before|after>-<hash>.jpg`
 * inside the preview folder, named by the page's address so a "before" taken
 * at creation is the one the tour shows later, and a changed address is a
 * new picture. Pure (paths only); the taking is lib/feedback/page-picture.
 */
import { createHash } from "crypto";
import path from "path";
import { LOKI_DIR } from "@/lib/previews/improvements";

export const PICTURES_DIR = `${LOKI_DIR}/pictures`;
export type PictureSide = "before" | "after";

export function pictureFile(dir: string, side: PictureSide, url: string): string {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);
  return path.join(dir, PICTURES_DIR, `${side}-${hash}.jpg`);
}

/** The header a preview is served with when Loki is photographing it — it then leaves its widget out. */
export const PICTURE_HEADER = "x-loki-picture";
