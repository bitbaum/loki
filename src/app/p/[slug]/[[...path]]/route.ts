import { readFile, stat } from "fs/promises";
import { NextRequest } from "next/server";
import { PREVIEWS } from "@/config/previews";
import { findPreviewProject } from "@/db/queries/previews";
import { getActiveWidgetToken } from "@/db/queries/widget-tokens";
import { handlePreviewGet, handlePreviewPost, type PreviewDeps } from "@/lib/previews/handle";
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

const deps: PreviewDeps = {
  async findProject(dir) {
    const project = await findPreviewProject(dir);
    if (!project) return null;
    const token = project.entityProjectId
      ? await getActiveWidgetToken(project.userId, project.entityProjectId)
      : null;
    return { name: project.name, widgetToken: token?.token ?? null };
  },
  async readFile(file) {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    return new Uint8Array(await readFile(file));
  },
  allowAttempt: (clientKey) =>
    checkRateLimit(
      `preview-code:${clientKey}`,
      PREVIEWS.attemptsPerWindow,
      PREVIEWS.attemptWindowMs,
    ),
  secureCookies: process.env.NODE_ENV === "production",
};

export async function GET(req: NextRequest, { params }: Params) {
  const { slug, path = [] } = await params;
  return handlePreviewGet(req, slug, path, deps);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params;
  return handlePreviewPost(req, slug, getClientIp(req), deps);
}
