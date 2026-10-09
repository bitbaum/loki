/**
 * POST /api/system/plan-grant — the operator grants, extends or revokes a
 * plan by hand. Operator only (users.is_default); everyone else gets 403.
 *
 * The same write the Bitcoin rail performs (updateUserBilling) and the same
 * ledger (oc_billing_grants, externalId "manual:…"), so a hand grant and a
 * settled pass are indistinguishable downstream and both show in the user's
 * Billing history. Replaces the box-only scripts/grant-plan.ts for the
 * common case: a pass paid outside the rail, a trial, a goodwill month.
 *
 *   { userId, plan, days?, reason? }  plan "free" = revoke now
 */
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { denyDemoInHandler } from "@/lib/demo-guard";
import { getUserById, isSiteOperator, updateUserBilling } from "@/db/queries/users";
import { recordOcBillingGrant } from "@/db/queries/billing-grants";
import { logDebug } from "@/db/queries/debug-logs";
import { PLAN_VALUES } from "@/db/schema/users";
import { DAY_MS } from "@/lib/constants/time";

const Body = z.object({
  userId: z.string().uuid(),
  plan: z.enum(PLAN_VALUES),
  days: z.number().int().positive().max(3660).default(30),
  reason: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const operatorId = await getApiUserId();
  if (!operatorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // /api/system is outside the proxy matcher, so the demo gate lives here —
  // see DEMO_HANDLER_ENFORCED in config/demo.ts.
  const demoDenied = await denyDemoInHandler(operatorId, "billing");
  if (demoDenied) return demoDenied;
  if (!(await isSiteOperator(operatorId).catch(() => false)))
    return jsonError("Only the operator can grant plans.", 403);

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { userId, plan, days, reason } = dataOrResp;

  const user = await getUserById(userId);
  if (!user) return jsonError("No such user.", 404);

  if (plan === "free") {
    await updateUserBilling(userId, { plan: "free", planStatus: "canceled", planExpiresAt: null });
    await logDebug({
      source: "system/plan-grant",
      level: "info",
      message: `plan revoked by operator: ${user.username ?? userId}`,
      meta: { userId, by: operatorId, reason: reason ?? null },
    }).catch(() => {});
    return jsonOk({ plan: "free", expiresAt: null });
  }

  // Extending a live pass counts from its current end, not from today.
  const base =
    user.plan === plan && user.planExpiresAt && user.planExpiresAt.getTime() > Date.now()
      ? user.planExpiresAt.getTime()
      : Date.now();
  const expiresAt = new Date(base + days * DAY_MS);
  await recordOcBillingGrant({
    userId,
    externalId: `manual:${crypto.randomUUID()}`,
    plan,
    periodDays: days,
    expiresAt,
    amountBtc: null,
  });
  await updateUserBilling(userId, { plan, planStatus: "active", planExpiresAt: expiresAt });
  await logDebug({
    source: "system/plan-grant",
    level: "info",
    message: `plan granted by operator: ${plan} for ${days}d to ${user.username ?? userId}`,
    meta: { userId, plan, days, by: operatorId, reason: reason ?? null },
  }).catch(() => {});
  return jsonOk({ plan, expiresAt: expiresAt.toISOString() });
}
