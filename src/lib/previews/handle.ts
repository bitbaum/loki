/**
 * The preview route's behaviour, on plain Request/Response with its lookups
 * passed in, so every path through it is tested without a database or a
 * server (scripts/test/previews-route.ts). The route file only wires the real
 * lookups in.
 */
import { createHash } from "crypto";
import path from "path";
import { PREVIEWS, previewEntryPath } from "@/config/previews";
import type { PagePicture, PictureOptions } from "@/lib/feedback/page-picture";
import {
  createPreviewAccessCookie,
  previewCodeFor,
  previewCodeMatches,
  verifyPreviewAccessCookie,
} from "@/lib/previews/access";
import { beforeAfterPage } from "@/lib/previews/before-after-page";
import { previewGatePage, previewNotFoundPage, previewsOffPage } from "@/lib/previews/gate-page";
import {
  IMPROVEMENTS_FILE,
  LOKI_PATH,
  SOURCE_FILE,
  beforeAfterPairs,
  parseImprovements,
  parsePreviewSource,
  walkthroughFrom,
  type BeforeAfterPair,
} from "@/lib/previews/improvements";
import { PICTURE_HEADER, pictureFile, type PictureSide } from "@/lib/previews/pictures";
import { previewDirFor } from "@/lib/previews/root";
import {
  injectPreviewWidget,
  isHtmlFile,
  previewContentType,
  resolvePreviewFile,
} from "@/lib/previews/serve";

export type PreviewDeps = {
  /** The project a preview folder belongs to (by folder path). */
  findProject(
    dir: string,
  ): Promise<{ name: string; widgetToken: string | null; code?: string | null } | null>;
  /** A file's bytes, or null when it is missing or not a file. */
  readFile(file: string): Promise<Uint8Array | null>;
  /** Keep a picture Loki took (creates the folder it goes in). */
  writeFile(file: string, bytes: Uint8Array): Promise<void>;
  /** Photograph a page the way a visitor on a phone sees it (lib/feedback/page-picture). */
  takePicture(url: string, opts: PictureOptions): Promise<PagePicture>;
  /** Wrong-code attempts: true while this visitor may still try. */
  allowAttempt(clientKey: string): boolean;
  secureCookies: boolean;
  /** Loki's own origin: the widget must load from here when the preview is a host's root. */
  appOrigin: string;
};

/**
 * Is this preview the whole of its own host (<label>.orangecat.ch, via the
 * Caddy vhost from attach-preview-host.sh) rather than a page under /p/<label>?
 * Caddy says so; a visitor who sends the header only changes where their own
 * cookie is scoped and where the gate posts, and the code is still required.
 */
export const ROOTED_HEADER = "x-preview-root";
const isRooted = (req: Request) => req.headers.get(ROOTED_HEADER) === "1";

const PRIVATE_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

async function locate(slug: string, deps: PreviewDeps) {
  const dir = previewDirFor(slug);
  const project = dir ? await deps.findProject(dir) : null;
  return dir && project ? { dir, project } : null;
}

const gateFor = (req: Request, slug: string, error?: string) =>
  previewGatePage({ postUrl: isRooted(req) ? "/" : `${PREVIEWS.routePrefix}/${slug}`, error });

export async function handlePreviewGet(
  req: Request,
  slug: string,
  segments: readonly string[],
  deps: PreviewDeps,
): Promise<Response> {
  const found = await locate(slug, deps);
  if (!found) return htmlResponse(previewNotFoundPage(), 404);

  // Open on the file, never the bare folder (see PREVIEWS.entryFile). A
  // redirect keeps the URL fragment, so an owner link survives it.
  if (segments.length === 0) {
    return new Response(null, {
      status: 307,
      headers: { Location: new URL(previewEntryPath(slug), req.url).toString() },
    });
  }
  const code = previewCodeFor(found.project.code);
  if (!code) return htmlResponse(previewsOffPage(), 503);

  const file = resolvePreviewFile(found.dir, segments);
  const type = file ? previewContentType(file) : null;

  if (!verifyPreviewAccessCookie(readCookie(req, PREVIEWS.cookie), Date.now(), code)) {
    // Pages get the gate; files get nothing, so a photo cannot be fetched by
    // guessing its path.
    const wantsPage =
      !file || isHtmlFile(file) || (req.headers.get("accept") ?? "").includes("text/html");
    if (!wantsPage) return new Response(null, { status: 401, headers: PRIVATE_HEADERS });
    return htmlResponse(gateFor(req, slug), 401);
  }

  if (segments[0] === LOKI_PATH) return lokiPage(req, slug, segments.slice(1), found, code, deps);

  const bytes = file && type ? await deps.readFile(file) : null;
  if (!file || !type || !bytes) return htmlResponse(previewNotFoundPage(), 404);

  if (!isHtmlFile(file)) {
    return new Response(bytes as BodyInit, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": type,
        "Cache-Control": "private, max-age=300",
      },
    });
  }
  return pageResponse(req, new TextDecoder().decode(bytes), found.project.widgetToken, deps);
}

/** A page of the preview, with Loki's widget on it — unless Loki itself is photographing it. */
function pageResponse(
  req: Request,
  html: string,
  widgetToken: string | null,
  deps: PreviewDeps,
): Response {
  let page = html;
  if (widgetToken && req.headers.get(PICTURE_HEADER) !== "1") {
    // On its own host a relative /widget.js would be asked of the preview.
    const src = isRooted(req) ? `${deps.appOrigin}/widget.js` : undefined;
    page = injectPreviewWidget(page, widgetToken, src);
  }
  return new Response(page, {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

type Found = NonNullable<Awaited<ReturnType<typeof locate>>>;
type Row = BeforeAfterPair & { newBytes: Uint8Array | null };

const utf8 = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);

/**
 * The rows of the tour for this folder: the agent's improvements.json over
 * what the preview was made from, each new page read so a missing file shows
 * the homepage (when the agent named it) or drops out (when Loki inferred it).
 */
async function tourRows(dir: string, deps: PreviewDeps): Promise<Row[]> {
  const [source, improvements] = await Promise.all([
    deps.readFile(path.join(dir, SOURCE_FILE)).then((b) => parsePreviewSource(utf8(b))),
    deps.readFile(path.join(dir, IMPROVEMENTS_FILE)).then((b) => parseImprovements(utf8(b))),
  ]);
  const rows: Row[] = [];
  for (const pair of beforeAfterPairs(source, improvements)) {
    const file = resolvePreviewFile(dir, pair.newPath.split("/"));
    const bytes = file && isHtmlFile(file) ? await deps.readFile(file) : null;
    if (bytes) rows.push({ ...pair, newBytes: bytes });
    else if (pair.fromAgent) {
      const home = resolvePreviewFile(dir, [PREVIEWS.entryFile]);
      rows.push({
        ...pair,
        newPath: PREVIEWS.entryFile,
        newBytes: home ? await deps.readFile(home) : null,
      });
    }
  }
  return rows;
}

const inFlight = new Map<string, Promise<PagePicture>>();

async function lokiPage(
  req: Request,
  slug: string,
  rest: readonly string[],
  found: Found,
  code: string,
  deps: PreviewDeps,
): Promise<Response> {
  if (rest.length !== 1) return htmlResponse(previewNotFoundPage(), 404);
  if (rest[0] === "before-after") {
    const [source, improvements, rows] = await Promise.all([
      deps.readFile(path.join(found.dir, SOURCE_FILE)).then((b) => parsePreviewSource(utf8(b))),
      deps
        .readFile(path.join(found.dir, IMPROVEMENTS_FILE))
        .then((b) => parseImprovements(utf8(b))),
      tourRows(found.dir, deps),
    ]);
    const html = beforeAfterPage({
      name: found.project.name,
      website: source?.website ?? null,
      pairs: rows,
      improvements,
      walkthrough: walkthroughFrom(improvements),
    });
    return pageResponse(req, html, found.project.widgetToken, deps);
  }
  if (rest[0] === "picture") {
    const url = new URL(req.url);
    const side = url.searchParams.get("side");
    const i = Number(url.searchParams.get("i"));
    if ((side !== "before" && side !== "after") || !Number.isInteger(i) || i < 0)
      return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
    const row = (await tourRows(found.dir, deps))[i];
    if (!row) return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
    return picture(side, row, slug, found.dir, code, deps);
  }
  return htmlResponse(previewNotFoundPage(), 404);
}

/**
 * One picture of the tour, taken the first time it is asked for and kept in
 * the folder. A "before" is the live page, keyed by its address; an "after"
 * is the new page served by Loki itself, opened with the preview's own access
 * cookie and keyed by the page's content, so a rebuilt page gets a new picture.
 */
async function picture(
  side: PictureSide,
  row: Row,
  slug: string,
  dir: string,
  code: string,
  deps: PreviewDeps,
): Promise<Response> {
  const target =
    side === "before"
      ? row.liveUrl
      : `${deps.appOrigin}${PREVIEWS.routePrefix}/${slug}/${row.newPath}`;
  const content = row.newBytes ? createHash("sha1").update(row.newBytes).digest("hex") : "";
  const file = pictureFile(dir, side, side === "before" ? target : `${target}#${content}`);
  const jpeg = (bytes: Uint8Array) =>
    new Response(bytes as BodyInit, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  const kept = await deps.readFile(file);
  if (kept) return jpeg(kept);

  const opts: PictureOptions =
    side === "after"
      ? {
          cookies: [
            {
              name: PREVIEWS.cookie,
              value: createPreviewAccessCookie(Date.now(), code) ?? "",
              url: deps.appOrigin,
            },
          ],
          headers: { [PICTURE_HEADER]: "1" },
        }
      : {};
  let taking = inFlight.get(file);
  if (!taking) {
    taking = deps.takePicture(target, opts);
    inFlight.set(file, taking);
    taking.catch(() => undefined).finally(() => inFlight.delete(file));
  }
  const shot = await taking.catch(() => null);
  if (!shot?.ok) return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
  const bytes = new Uint8Array(Buffer.from(shot.base64, "base64"));
  await deps.writeFile(file, bytes).catch(() => undefined);
  return jpeg(bytes);
}

/** The code, from the gate's script (JSON) or a plain form post. */
async function readCode(req: Request): Promise<string> {
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
    return typeof body?.code === "string" ? body.code : "";
  }
  const form = await req.formData().catch(() => null);
  const value = form?.get("code");
  return typeof value === "string" ? value : "";
}

export async function handlePreviewPost(
  req: Request,
  slug: string,
  clientKey: string,
  deps: PreviewDeps,
): Promise<Response> {
  const found = await locate(slug, deps);
  if (!found) return htmlResponse(previewNotFoundPage(), 404);
  const code = previewCodeFor(found.project.code);
  if (!code) return htmlResponse(previewsOffPage(), 503);

  const json = (req.headers.get("content-type") ?? "").includes("application/json");
  const fail = (error: string, status: number) =>
    json
      ? Response.json({ error }, { status, headers: PRIVATE_HEADERS })
      : htmlResponse(gateFor(req, slug, error), status);

  if (!deps.allowAttempt(clientKey)) {
    return fail("Too many tries. Wait a few minutes and try again.", 429);
  }
  if (!previewCodeMatches(await readCode(req), code)) {
    return fail("That code does not open this preview. Check it and try again.", 401);
  }
  const cookie = createPreviewAccessCookie(Date.now(), code);
  if (!cookie) return htmlResponse(previewsOffPage(), 503);

  const setCookie = [
    `${PREVIEWS.cookie}=${cookie}`,
    // Rooted: the preview is the host, so the cookie must reach every path.
    `Path=${isRooted(req) ? "/" : PREVIEWS.routePrefix}`,
    `Max-Age=${Math.floor(PREVIEWS.cookieTtlMs / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(deps.secureCookies ? ["Secure"] : []),
  ].join("; ");
  const headers = new Headers(PRIVATE_HEADERS);
  headers.append("Set-Cookie", setCookie);
  if (json) {
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ ok: true }), { headers });
  }
  headers.set(
    "Location",
    new URL(isRooted(req) ? "/" : previewEntryPath(slug), req.url).toString(),
  );
  return new Response(null, { status: 303, headers });
}
