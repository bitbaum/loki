import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { PackageUpdateSettingBody, SETTING_APPLIES_WHEN } from "@/config/package-updates";
import { setProjectPackageUpdates } from "@/db/queries/package-updates";
import { syncUserPackages } from "@/lib/packages/sync";

/** How long the answer waits for the setting to reach the open pull requests. */
const APPLY_WAIT_MS = 8_000;

/**
 * How shared-package updates reach one project: "auto", "ask" or "pinned"
 * (src/config/package-updates.ts). Owner only — the row must be the caller's —
 * and addressed by either of the project's ids.
 *
 * The new setting is applied to the project's open update pull requests at
 * once when GitHub answers in time; otherwise the 15-minute timer applies it,
 * and the answer says so instead of pretending.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const body = await readJsonBody(req, PackageUpdateSettingBody);
  if (body instanceof NextResponse) return body;

  const project = await setProjectPackageUpdates(userId, idOrResp, body.setting);
  if (!project) return jsonError("Project not found", 404);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const applied = await Promise.race([
    syncUserPackages(userId, { onlyProjectId: project.id, updatesOnly: true })
      .then((s) => s.results.every((r) => !r.updates?.error))
      .catch(() => false),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), APPLY_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  return jsonOk({
    setting: body.setting,
    applied,
    message: applied ? "Applied to its open updates." : SETTING_APPLIES_WHEN,
  });
}
