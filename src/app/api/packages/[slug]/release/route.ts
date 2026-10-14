import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  RELEASE_MESSAGES,
  RELEASES_PER_HOUR,
  StartReleaseBody,
  UNRELEASED_LIST_LIMIT,
} from "@/config/package-releases";
import { getCataloguePackageBySlug } from "@/lib/packages/catalogue";
import { resolveReleaseAccess } from "@/lib/packages/release-access";
import { readRelease, releaseBlocker, startRelease } from "@/lib/packages/release";

/**
 * The release panel on /packages/[slug]: what is unreleased, the version it
 * makes, and whether the caller may release it. Who may is the package's
 * owner (src/config/package-releases.ts); anyone else gets the reason, as
 * state rather than as an error, so the page can say it in place.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const pkg = await getCataloguePackageBySlug((await params).slug);
  if (!pkg) return jsonError("Package not found", 404);
  const access = await resolveReleaseAccess(userId, pkg);
  if (!access.ok) {
    return jsonOk({
      access: { ok: false, reason: access.reason, connectGithub: access.connectGithub },
    });
  }
  const release = await readRelease(
    access.gh,
    access.ref,
    access.defaultBranch,
    UNRELEASED_LIST_LIMIT,
  );
  return jsonOk({
    access: { ok: true, via: access.via },
    release,
    blocker: releaseBlocker(release),
  });
}

/**
 * Start the package repository's release.yml for exactly the version the
 * panel showed. Owner only; a suggestion that moved since the page was read
 * starts nothing (409) and says to look again.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, StartReleaseBody);
  if (body instanceof NextResponse) return body;
  if (!checkRateLimit(`package-release:${userId}`, RELEASES_PER_HOUR, 3_600_000)) {
    return jsonError(RELEASE_MESSAGES.rateLimited, 429);
  }
  const pkg = await getCataloguePackageBySlug((await params).slug);
  if (!pkg) return jsonError("Package not found", 404);
  const access = await resolveReleaseAccess(userId, pkg);
  if (!access.ok) return jsonError(access.reason, 403, { connectGithub: access.connectGithub });
  const result = await startRelease(access.gh, access.ref, access.defaultBranch, body);
  if (!result.ok) return jsonError(result.message, result.status);
  return jsonOk({ message: result.message, version: result.version });
}
