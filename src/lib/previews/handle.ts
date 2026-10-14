/**
 * The preview route's behaviour, on plain Request/Response with its lookups
 * passed in, so every path through it is tested without a database or a
 * server (scripts/test/previews-route.ts). The route file only wires the real
 * lookups in.
 */
import { PREVIEWS, previewEntryPath } from "@/config/previews";
import {
  configuredPreviewCode,
  createPreviewAccessCookie,
  previewCodeMatches,
  verifyPreviewAccessCookie,
} from "@/lib/previews/access";
import { previewGatePage, previewNotFoundPage, previewsOffPage } from "@/lib/previews/gate-page";
import { previewDirFor } from "@/lib/previews/root";
import {
  injectPreviewWidget,
  isHtmlFile,
  previewContentType,
  resolvePreviewFile,
} from "@/lib/previews/serve";

export type PreviewDeps = {
  /** The project a preview folder belongs to (by folder path). */
  findProject(dir: string): Promise<{ name: string; widgetToken: string | null } | null>;
  /** A file's bytes, or null when it is missing or not a file. */
  readFile(file: string): Promise<Uint8Array | null>;
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

const gateFor = (req: Request, slug: string, name: string, error?: string) =>
  previewGatePage({
    name,
    postUrl: isRooted(req) ? "/" : `${PREVIEWS.routePrefix}/${slug}`,
    error,
  });

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
  if (!configuredPreviewCode()) return htmlResponse(previewsOffPage(), 503);

  const file = resolvePreviewFile(found.dir, segments);
  const type = file ? previewContentType(file) : null;

  if (!verifyPreviewAccessCookie(readCookie(req, PREVIEWS.cookie))) {
    // Pages get the gate; files get nothing, so a photo cannot be fetched by
    // guessing its path.
    const wantsPage =
      !file || isHtmlFile(file) || (req.headers.get("accept") ?? "").includes("text/html");
    if (!wantsPage) return new Response(null, { status: 401, headers: PRIVATE_HEADERS });
    return htmlResponse(gateFor(req, slug, found.project.name), 401);
  }

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
  let page = new TextDecoder().decode(bytes);
  if (found.project.widgetToken) {
    // On its own host a relative /widget.js would be asked of the preview.
    const src = isRooted(req) ? `${deps.appOrigin}/widget.js` : undefined;
    page = injectPreviewWidget(page, found.project.widgetToken, src);
  }
  return new Response(page, {
    headers: { ...PRIVATE_HEADERS, "Content-Type": type, "Cache-Control": "no-store" },
  });
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
  if (!configuredPreviewCode()) return htmlResponse(previewsOffPage(), 503);

  const json = (req.headers.get("content-type") ?? "").includes("application/json");
  const fail = (error: string, status: number) =>
    json
      ? Response.json({ error }, { status, headers: PRIVATE_HEADERS })
      : htmlResponse(gateFor(req, slug, found.project.name, error), status);

  if (!deps.allowAttempt(clientKey)) {
    return fail("Too many tries. Wait a few minutes and try again.", 429);
  }
  if (!previewCodeMatches(await readCode(req))) {
    return fail("That code does not open this preview. Check it and try again.", 401);
  }
  const cookie = createPreviewAccessCookie();
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
