import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/session";
import { jsonError, jsonOk, readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { getProjectCore } from "@/db/queries/projects";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { getExecutionAccess } from "@/lib/execution-access";
import { readAppsConf } from "@/lib/register/apps-conf";
import { studioRepoRoot } from "@/lib/site-cd-local";
import { siteCdSlug } from "@/lib/site-cd";
import { checkOwnDomain, setOwnDomain, type OwnDomainResult } from "@/lib/site-domain-attach";
import { normalizeOwnDomain } from "@/lib/site-domain";

/**
 * A site's own domain: evig.orangecat.ch → evig.ch.
 *
 *   GET    ?domain=evig.ch  the records to set and whether they are set (no change)
 *   POST   { domain }       make it the site's address (DNS must point here)
 *   DELETE                  go back to the free address
 *
 * The box script (scripts/hetzner/attach-domain.sh) is the authority; see
 * docs/infrastructure/custom-domains.md.
 */
export const maxDuration = 180;

type Ctx = { params: Promise<{ id: string }> };

async function loadSite(params: Ctx["params"]) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const id = await readIdParam(params);
  if (id instanceof NextResponse) return id;
  const [project, up] = await Promise.all([
    getProjectCore(userId, id),
    getUserProjectByEntityId(userId, id),
  ]);
  if (!project || !up) return jsonError("Not found", 404);
  if (!up.liveUrl) {
    return jsonError(
      "This project has no live site yet. Put it live first, then connect a domain.",
      400,
    );
  }
  // The register row that serves the live host names the site; a project
  // renamed after registration still maps to the row it was registered as.
  let host: string | null = null;
  try {
    host = new URL(up.liveUrl).hostname;
  } catch {
    /* fall through to the name */
  }
  // The box's working register first: an attach lands there before main.
  const apps = [...readAppsConf(studioRepoRoot()), ...readAppsConf()];
  const row = host ? apps.find((app) => app.domains.includes(host)) : undefined;
  return { userId, id, up, slug: row?.name ?? siteCdSlug(project.name) };
}

function respond(result: OwnDomainResult) {
  if (result.status === "failed") return jsonError(result.reason, 502, result);
  return jsonOk(result);
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const site = await loadSite(params);
  if (site instanceof NextResponse) return site;
  const parsed = normalizeOwnDomain(req.nextUrl.searchParams.get("domain") ?? "");
  if (!parsed.ok) return jsonError(parsed.error, 400);
  return jsonOk({ check: await checkOwnDomain(parsed.domain, site.slug) });
}

const Body = z.object({ domain: z.string().max(253) });

export async function POST(req: NextRequest, { params }: Ctx) {
  const site = await loadSite(params);
  if (site instanceof NextResponse) return site;
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  const parsed = normalizeOwnDomain(body.domain);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const access = await getExecutionAccess(site.userId);
  return respond(
    await setOwnDomain({
      userId: site.userId,
      entityProjectId: site.id,
      userProjectId: site.up.id,
      slug: site.slug,
      domain: parsed.domain,
      cloudBuilderAllowed: access.cloudBuilderAllowed,
    }),
  );
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const site = await loadSite(params);
  if (site instanceof NextResponse) return site;
  const access = await getExecutionAccess(site.userId);
  return respond(
    await setOwnDomain({
      userId: site.userId,
      entityProjectId: site.id,
      userProjectId: site.up.id,
      slug: site.slug,
      domain: null,
      cloudBuilderAllowed: access.cloudBuilderAllowed,
    }),
  );
}
