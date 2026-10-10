/**
 * How Auto spends on the person's own keys.
 *
 *   GET → { stance, picks: [{ tier, vendor, model, name, reason, chosenBy }],
 *           candidates: [{ vendor, model, name, index, outPerM, tier }], keys }
 *   PUT { stance } | { tier, vendor, model } | { tier, reset: true }
 *
 * The picks are computed from the catalogue and the keys held
 * (lib/models/routing.ts); a PUT with a tier stores the person's own choice
 * for it, which wins until reset. A choice must name a key they hold.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { VENDOR_IDS, type VendorId } from "@/config/model-vendors";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { upsertUserPreferences } from "@/db/queries/user-preferences";
import { clearTierOverride, setTierOverride } from "@/db/queries/user-model-tiers";
import { listOwnModels } from "@/db/queries/user-model-keys";
import { STANCES, type Stance } from "@/lib/models/auto-picks";
import { routingFor } from "@/lib/models/routing";

export const runtime = "nodejs";

const Tier = z.enum(["economy", "standard", "frontier"]);
const Body = z.union([
  z.object({ stance: z.enum(STANCES.map((s) => s.id) as [Stance, ...Stance[]]) }),
  z.object({ tier: Tier, reset: z.literal(true) }),
  z.object({
    tier: Tier,
    vendor: z.enum(VENDOR_IDS as [VendorId, ...VendorId[]]),
    model: z.string().trim().min(1).max(200),
  }),
]);

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  return jsonOk(await routingFor(userId));
}

export async function PUT(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;

  if ("stance" in body) {
    await upsertUserPreferences(userId, { modelStance: body.stance });
  } else if ("reset" in body) {
    await clearTierOverride(userId, body.tier);
  } else {
    const held = await listOwnModels(userId);
    if (!held.some((k) => k.vendor === body.vendor)) {
      return jsonError("That model needs a key you hold — add one first.", 400);
    }
    await setTierOverride(userId, body.tier, body.vendor, body.model);
  }
  return jsonOk(await routingFor(userId));
}
