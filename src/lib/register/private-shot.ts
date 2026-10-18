/**
 * The picture on a private project's tile (bitbaum.orangecat.ch/private/).
 *
 * The public work grid shows a screenshot of every project, published as a
 * file at build time. A private project's screenshot cannot be a public file —
 * the client has not agreed to be shown — so Loki takes it and serves it to the
 * studio owner alone, at the size the public tiles use, and the studio site
 * draws both kinds of tile with one renderer (site/card.mjs in bitbaum).
 *
 * Pure: what to photograph and how. The route does the taking and the keeping.
 */
import { createHash } from "crypto";
import { PREVIEWS } from "@/config/previews";
import { PICTURE_HEADER } from "@/lib/previews/pictures";
import type { PictureOptions } from "@/lib/feedback/page-picture";

/** The public tiles' screenshot size (bitbaum site/shots, 1280×800). */
export const TILE_VIEWPORT = { width: 1280, height: 800 } as const;
/** A site changes; a day-old picture of it is still a fair picture. */
export const TILE_SHOT_TTL_MS = 12 * 60 * 60 * 1000;

export type TileShotPlan = { target: string; opts: PictureOptions; key: string };

/**
 * A preview is photographed through Loki's own route with the owner's access
 * cookie — the same way the before/after tour photographs it — and told it is
 * being photographed, so its feedback widget stays out of the picture. Any
 * other site is photographed at its address as a visitor sees it.
 */
export function tileShotPlan(input: {
  slug: string;
  live: string;
  appOrigin: string;
  /** The preview's access cookie, when the project is one of Loki's previews. */
  previewCookie: string | null;
}): TileShotPlan {
  const { slug, live, appOrigin, previewCookie } = input;
  const target = previewCookie ? `${appOrigin}${PREVIEWS.routePrefix}/${slug}/` : live;
  const opts: PictureOptions = previewCookie
    ? {
        viewport: TILE_VIEWPORT,
        cookies: [{ name: PREVIEWS.cookie, value: previewCookie, url: appOrigin }],
        headers: { [PICTURE_HEADER]: "1" },
      }
    : { viewport: TILE_VIEWPORT };
  // Named by the address, so a project that moves gets a new picture.
  const key = `${slug}-${createHash("sha1").update(target).digest("hex").slice(0, 12)}`;
  return { target, opts, key };
}

/** A site behind its own access-code page: the picture would be the code page, not the site. */
export function isAccessGate(headers: Headers): boolean {
  return headers.has("x-access-gate");
}
