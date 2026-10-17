import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import { PREVIEWS } from "@/config/previews";
import { findPreviewProject } from "@/db/queries/previews";
import { getPreviewCode } from "@/db/queries/preview-code";
import { getActiveWidgetToken } from "@/db/queries/widget-tokens";
import { handlePreviewGet, handlePreviewPost, type PreviewDeps } from "@/lib/previews/handle";
import { appUrl } from "@/lib/email";
import { takePagePicture } from "@/lib/feedback/page-picture";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * A prospect preview: a site Loki built for someone who is not a customer yet,
 * served from its folder on the box behind the access code, with Loki's
 * widget on every page so they can say what to change.
 *
 * Public in src/proxy.ts (`p/`): the person it was built for has no account.
 * The code is checked on every request, pages and files alike. Behaviour lives
 * in src/lib/previews/handle.ts (tested); this file wires in the database and
 * the disk. Design: docs/architecture/prospect-previews.md.
 */

type Params = { params: Promise<{ slug: string; path?: string[] }> };

type Project = Awaited<ReturnType<PreviewDeps["findProject"]>>;
// A page of a preview asks for its stylesheet, its fonts and every image, and
// each request looked the project up again (four round trips). The answer is
// kept for a few seconds — long enough for one page load, short enough that a
// changed code asks every visitor again within the minute.
const PROJECT_MEMO_MS = 5_000;
const projects = new Map<string, { at: number; value: Promise<Project> }>();

async function lookupProject(dir: string): Promise<Project> {
  const project = await findPreviewProject(dir);
  if (!project) return null;
  const token = project.entityProjectId
    ? await getActiveWidgetToken(project.userId, project.entityProjectId)
    : null;
  return {
    name: project.name,
    widgetToken: token?.token ?? null,
    code: await getPreviewCode(project.userId),
  };
}

const deps: PreviewDeps = {
  async findProject(dir) {
    const hit = projects.get(dir);
    if (hit && Date.now() - hit.at < PROJECT_MEMO_MS) return hit.value;
    const value = lookupProject(dir);
    projects.set(dir, { at: Date.now(), value });
    // "No such preview" is not kept: creation asks the address whether it
    // answers BEFORE the project row exists, and a kept null made the first
    // visitor's request a 404 (center-com-3, 2026-10-17).
    value.then((p) => p ?? projects.delete(dir)).catch(() => projects.delete(dir));
    if (projects.size > 200) projects.delete(projects.keys().next().value!);
    return value;
  },
  async readFile(file) {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    return new Uint8Array(await readFile(file));
  },
  async writeFile(file, bytes) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  },
  takePicture: (url, opts) => takePagePicture(url, null, opts),
  allowAttempt: (clientKey) =>
    checkRateLimit(
      `preview-code:${clientKey}`,
      PREVIEWS.attemptsPerWindow,
      PREVIEWS.attemptWindowMs,
    ),
  secureCookies: process.env.NODE_ENV === "production",
  appOrigin: new URL(appUrl()).origin,
};

export async function GET(req: NextRequest, { params }: Params) {
  const { slug, path = [] } = await params;
  return handlePreviewGet(req, slug, path, deps);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params;
  return handlePreviewPost(req, slug, getClientIp(req), deps);
}
