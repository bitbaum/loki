import { NextRequest } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { accounts, userProjects } from "@/db/schema";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readIdParam } from "@/lib/api/route-helpers";
import { solonFoundingUrl } from "@/lib/integrations/solon-grant";
import { canonicalSlug, repoFromGitUrl, usefulDescription } from "@/lib/register/build";
import { SOLON_BASE, solonClaims } from "@/lib/register/solon";

/**
 * GET /api/user-projects/[id]/solon-grant — what this project can do about Solon.
 *
 * Four answers, and the UI renders nothing for two of them:
 *
 *   governed   an organization already governs this project — link to it
 *   foundable  its owner may found one; carries a fresh, short-lived grant
 *   unlinked   connect OrangeCat first: a grant is signed FOR an OrangeCat
 *              identity, and there is none to sign for
 *   unknown    Solon could not be reached, so we cannot tell "has none" from
 *              "could not look" — and offering to found a second organization
 *              for a project that already has one is the wrong guess
 *
 * Unlike publishing to OrangeCat, Loki cannot do this for the owner: founding
 * needs a signature from their own Bitcoin wallet, which Loki never holds. This
 * only mints the handoff.
 *
 * The secret never leaves the server — only a signature does, bound to one
 * identity, one project and one expiry.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (typeof idOrResp !== "string") return idOrResp;

  const project = await db.query.userProjects.findFirst({
    where: and(
      eq(userProjects.userId, userId),
      or(eq(userProjects.id, idOrResp), eq(userProjects.entityProjectId, idOrResp)),
    ),
    columns: { name: true, slug: true, gitUrl: true, description: true, solonOrgSlug: true },
  });
  if (!project) return jsonError("Not found", 404);

  // The identity the REGISTER joins on. Founding under any other name would
  // produce an organization the register never looks up.
  const slug = canonicalSlug(project.slug || repoFromGitUrl(project.gitUrl) || project.name);

  const solon = await solonClaims();
  const orgSlug = project.solonOrgSlug ?? solon.claims.get(slug) ?? null;
  if (orgSlug) return jsonOk({ state: "governed", orgSlug, url: `${SOLON_BASE}/orgs/${orgSlug}` });
  if (!solon.checked) return jsonOk({ state: "unknown" });

  // Only the actor id is needed, so this reads the stored link directly rather
  // than going through getOrangeCatLink(), which refreshes an access token this
  // never uses — and would report "unlinked" for a link that is merely stale.
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, "orangecat")),
    columns: { providerAccountId: true },
  });
  if (!account?.providerAccountId) return jsonOk({ state: "unlinked" });

  const url = solonFoundingUrl({
    base: SOLON_BASE,
    project: slug,
    name: project.name,
    description: usefulDescription(project.description),
    actorId: account.providerAccountId,
    secret: process.env.SOLON_WEBHOOK_SECRET,
    nowSecs: Math.floor(Date.now() / 1000),
  });
  // No shared secret: Loki cannot vouch, so it offers nothing rather than a link
  // that would found an organization governing nothing.
  if (!url) return jsonOk({ state: "unavailable" });
  return jsonOk({ state: "foundable", url });
}
