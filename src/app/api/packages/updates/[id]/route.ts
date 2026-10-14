import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { UpdateDecisionBody } from "@/config/package-updates";
import { dbUpdateStore, getUpdateRequestForUser } from "@/db/queries/package-updates";
import { getPackageCatalogue } from "@/lib/packages/catalogue";
import { parseGithubRepo } from "@/lib/github-repo-ref";
import { repoTokenPicker } from "@/lib/packages/sync";
import { githubUpdateClient } from "@/lib/packages/update-github";
import { applyUpdateDecision } from "@/lib/packages/updates";
import { listReleasePauses } from "@/db/queries/package-releases";

/** Each decision is a few GitHub writes; a double-press must not become a dozen. */
const DECISIONS_PER_MINUTE = 20;

/**
 * A person's decision on one held package update, from its Approvals card:
 * "update", "later" or "stay" (src/config/package-updates.ts). Only the
 * owner of the update's project may decide. A refusal from GitHub comes back
 * as a 502 with the sentence to show, never as a silent success.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const body = await readJsonBody(req, UpdateDecisionBody);
  if (body instanceof NextResponse) return body;
  if (!checkRateLimit(`package-update-decision:${userId}`, DECISIONS_PER_MINUTE, 60_000)) {
    return jsonError("Too many decisions at once — wait a moment.", 429);
  }

  const found = await getUpdateRequestForUser(userId, idOrResp);
  if (!found) return jsonError("Update not found", 404);
  const ref = parseGithubRepo(found.project.gitUrl);
  if (!ref) return jsonError("This project has no GitHub repository any more.", 409);

  const [catalogue, tokenFor, pauses] = await Promise.all([
    getPackageCatalogue(),
    repoTokenPicker(userId),
    listReleasePauses().catch(() => []),
  ]);
  const result = await applyUpdateDecision(
    {
      userId,
      project: found.project,
      ref,
      catalogueNames: new Set(catalogue.packages.map((pkg) => pkg.name)),
      gh: githubUpdateClient(tokenFor(found.project, ref)),
      store: dbUpdateStore,
      now: new Date(),
      pauses,
    },
    found.request,
    body.decision,
  );
  if (!result.ok) return jsonError(result.message, 502, { state: result.state });
  return jsonOk({ state: result.state, message: result.message });
}
