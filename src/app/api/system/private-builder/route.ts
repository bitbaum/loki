/**
 * POST /api/system/private-builder — the operator switches an account's
 * private builder on or off. Operator only (users.is_default).
 *
 * The flag is the whole switch: within a minute the box reconciles it
 * (scripts/hetzner/reconcile-tenants.sh → new-tenant.sh), so the account has
 * its own Linux user, home, runner token and unit, and its Sessions page
 * shows its own cloud builder. Off: the unit stops, the home is kept.
 * docs/architecture/private-builders.md.
 *
 *   { userId, enabled }
 */
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { denyDemoInHandler } from "@/lib/demo-guard";
import { getUserById, isSiteOperator, setPrivateBuilder } from "@/db/queries/users";
import { logDebug } from "@/db/queries/debug-logs";

const Body = z.object({ userId: z.string().uuid(), enabled: z.boolean() });

export async function POST(req: NextRequest) {
  const operatorId = await getApiUserId();
  if (!operatorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // /api/system is outside the proxy matcher, so the demo gate lives here —
  // see DEMO_HANDLER_ENFORCED in config/demo.ts.
  const demoDenied = await denyDemoInHandler(operatorId, "billing");
  if (demoDenied) return demoDenied;
  if (!(await isSiteOperator(operatorId).catch(() => false)))
    return jsonError("Only the operator can switch a private runner.", 403);

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { userId, enabled } = dataOrResp;

  const user = await getUserById(userId);
  if (!user) return jsonError("No such user.", 404);
  // The founder builds on the box's own unit; the flag is for everyone else.
  if (user.isDefault) return jsonError("The operator's runner is the box's own unit.", 409);

  await setPrivateBuilder(userId, enabled);
  await logDebug({
    source: "system/private-builder",
    level: "info",
    message: `private runner ${enabled ? "on" : "off"}: ${user.username ?? userId}`,
    meta: { userId, by: operatorId },
  }).catch(() => {});
  return jsonOk({ userId, privateBuilder: enabled });
}
