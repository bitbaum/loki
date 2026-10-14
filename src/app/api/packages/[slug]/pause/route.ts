import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { PAUSES_PER_MINUTE, ReleasePauseBody, pauseResultMessage } from "@/config/package-releases";
import { pauseRelease, resumeRelease } from "@/db/queries/package-releases";
import { getCataloguePackageBySlug } from "@/lib/packages/catalogue";
import { applyReleasePause } from "@/lib/packages/pause-apply";
import { resolveReleaseAccess } from "@/lib/packages/release-access";

/**
 * Pause one release of a package everywhere, or resume it — the package
 * owner's kill switch. `{ version, paused: true }` stores the pause and holds
 * every open update to that version in every project at once; `paused: false`
 * removes it and takes off only the holds nothing else still wants
 * (src/lib/packages/update-policy.ts). Owner only — the same owner who may
 * release it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, ReleasePauseBody);
  if (body instanceof NextResponse) return body;
  if (!checkRateLimit(`package-pause:${userId}`, PAUSES_PER_MINUTE, 60_000)) {
    return jsonError("Pressed several times just now — wait a moment.", 429);
  }
  const pkg = await getCataloguePackageBySlug((await params).slug);
  if (!pkg) return jsonError("Package not found", 404);
  const access = await resolveReleaseAccess(userId, pkg);
  if (!access.ok) return jsonError(access.reason, 403, { connectGithub: access.connectGithub });

  if (body.paused) await pauseRelease(userId, pkg.name, body.version);
  else await resumeRelease(pkg.name, body.version);
  // The decision is stored; reaching GitHub now is a courtesy the 15-minute
  // read would also do, so a failure here is reported, not returned as one.
  const applied = await applyReleasePause(pkg.name, body.version).catch(() => ({
    projects: 0,
    held: 0,
    failed: 1,
  }));
  return jsonOk({
    paused: body.paused,
    applied,
    message: pauseResultMessage(body.paused, body.version, applied),
  });
}
