/**
 * The models a user brings to power Loki — list, add or replace, change,
 * re-order, remove. One key per vendor; the order is the user's own chain.
 *
 *   GET    → { available, models: [{ vendor, model, keyHint, verifiedAt, position }],
 *              usage: [{ vendor, tokensToday, callsToday, tokens30d, calls30d }], billing }
 *   PUT    { vendor, model, apiKey? } → adds or replaces that vendor's key;
 *                                       apiKey omitted = change model, keep key
 *   PATCH  { order: [vendor, …] }     → re-order the chain
 *   DELETE { vendor }                 → forgets that vendor's key
 *
 * A key is never returned by any method; `keyHint` ("…abcd") is all a client
 * ever sees. Checking a key WITHOUT saving it is ./probe.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BYOK_VENDOR_IDS, isByokConfig, type ByokVendorId } from "@bitbaum/ai-kit/byok";
import { probeByokKey } from "@bitbaum/ai-kit/byok-probe";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { ownModelVerdict } from "@/lib/own-model-verdict";
import { OWN_MODEL_BILLING } from "@/config/own-model-vendors";
import { ownUsageByVendor } from "@/db/queries/own-model-usage";
import {
  deleteOwnModel,
  listOwnModels,
  ownModelSealSecret,
  reorderOwnModels,
  saveOwnModel,
  setOwnModelChoice,
  type OwnModelSummary,
} from "@/db/queries/user-model-keys";

export const runtime = "nodejs";

const NOT_SET_UP =
  "Connecting your own model isn't switched on for this server yet — Loki keeps using its free models.";

const Vendor = z.enum(BYOK_VENDOR_IDS as [ByokVendorId, ...ByokVendorId[]]);

function view(summary: OwnModelSummary) {
  return {
    vendor: summary.vendor,
    model: summary.model,
    keyHint: summary.keyHint,
    verifiedAt: summary.verifiedAt.toISOString(),
    position: summary.position,
  };
}

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const [models, usage] = await Promise.all([
    listOwnModels(userId),
    ownUsageByVendor(userId).catch(() => []),
  ]);
  return jsonOk({
    available: ownModelSealSecret() !== null,
    models: models.map(view),
    // What each key has cost at its vendor — tokens and calls, today and over
    // 30 days — and where its spending cap is set. The vendor's meter is the
    // bill; this is the reader's own count beside it.
    usage,
    billing: OWN_MODEL_BILLING,
  });
}

const PutBody = z.object({
  vendor: Vendor,
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().min(8).max(400).optional(),
});

export async function PUT(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  if (ownModelSealSecret() === null) return jsonError(NOT_SET_UP, 503);
  if (!checkRateLimit(`own-model:${userId}`, 20, 10 * 60_000)) {
    return jsonError("Too many attempts — wait a few minutes and try again.", 429);
  }
  const body = await readJsonBody(req, PutBody);
  if (body instanceof NextResponse) return body;

  if (!body.apiKey) {
    const changed = await setOwnModelChoice(userId, body.vendor, body.model);
    if (!changed) return jsonError("Paste your key for this provider first.", 400);
    return jsonOk({ models: (await listOwnModels(userId)).map(view) });
  }

  const config = { vendor: body.vendor, apiKey: body.apiKey, model: body.model };
  if (!isByokConfig(config)) return jsonError("That key or model id is not valid.", 400);
  // Saved once the vendor KNOWS the key. A key it refuses is not stored, and
  // the vendor's own words say why. A key it knows but cannot bill yet (no
  // credits, a spending limit) IS stored — the account is one top-up away
  // from working, and refusing it was a wall (xAI, 2026-10-10).
  const probe = await probeByokKey(config.vendor, config.apiKey);
  const verdict = ownModelVerdict(probe);
  if (verdict === "unreachable") return jsonError(probe.message, 502);
  if (verdict === "refused") return jsonError(probe.message, 400);
  await saveOwnModel(userId, config);
  return jsonOk({
    models: (await listOwnModels(userId)).map(view),
    ...(verdict === "unfunded"
      ? { unfunded: { message: probe.message, billing: OWN_MODEL_BILLING[config.vendor] } }
      : {}),
  });
}

const PatchBody = z.object({ order: z.array(Vendor).min(1).max(20) });

export async function PATCH(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, PatchBody);
  if (body instanceof NextResponse) return body;
  return jsonOk({ models: (await reorderOwnModels(userId, body.order)).map(view) });
}

const DeleteBody = z.object({ vendor: Vendor });

export async function DELETE(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const body = await readJsonBody(req, DeleteBody);
  if (body instanceof NextResponse) return body;
  await deleteOwnModel(userId, body.vendor);
  return jsonOk({ models: (await listOwnModels(userId)).map(view) });
}
