import { DAY_MS, MINUTE_MS } from "@/lib/constants/time";

/**
 * SSOT for prospect previews: sites Loki builds for someone who is not a
 * customer yet, shown to them privately before anyone opens a repository.
 *
 * A preview is a folder on the box, not a repository: `<root>/<slug>/`, with
 * its own local git history so every change can be undone and the whole
 * folder can become a real repository the day they say yes. Thousands of
 * prospects therefore cost thousands of folders, not thousands of GitHub
 * repositories. Full design: docs/architecture/prospect-previews.md.
 */
export const PREVIEWS = {
  /** Where previews are served. Public in src/proxy.ts; the code is the gate. */
  routePrefix: "/p",
  /**
   * The file a preview opens on. Served at /p/<slug>/index.html rather than
   * /p/<slug> so the site's own relative links (img/…, media/…) resolve inside
   * its folder: Next strips a trailing slash, and /p/<slug> would resolve
   * `img/a.jpg` to /p/img/a.jpg.
   */
  entryFile: "index.html",
  // The access code is LOKI_PREVIEW_CODE in the box env, one value for every
  // preview (src/lib/previews/access.ts). Changing it is one line in
  // /opt/loki/app/.env and a restart; every visitor who entered the old one is
  // asked again. Unset = previews answer "switched off".
  // The folders live in LOKI_PREVIEWS_ROOT, default $LOKI_BOX_DEV_ROOT/previews
  // (src/lib/previews/root.ts).
  cookie: "loki_preview",
  cookieTtlMs: 30 * DAY_MS,
  /** Wrong-code attempts per visitor before a pause. */
  attemptsPerWindow: 10,
  attemptWindowMs: 15 * MINUTE_MS,
  /** Longest folder name; a slug is also the URL a prospect reads. */
  maxSlugLength: 48,
} as const;

/** The address a preview opens on. */
export function previewEntryPath(slug: string): string {
  return `${PREVIEWS.routePrefix}/${slug}/${PREVIEWS.entryFile}`;
}
