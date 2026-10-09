/**
 * The models a user brings to power Loki — list, add or replace, change,
 * re-order, remove. One key per vendor; the order is the user's own chain.
 *
 *   GET    → { available, models: [{ vendor, model, keyHint, verifiedAt, position }] }
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
  return jsonOk({
    available: ownModelSealSecret() !== null,
    models: (await listOwnModels(userId)).map(view),
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
  // Saved only once the vendor has accepted it: a key that is refused is not
  // stored, and the vendor's own words say why.
  const probe = await probeByokKey(config.vendor, config.apiKey);
  if (!probe.ok) return jsonError(probe.message, probe.status === null ? 502 : 400);
  await saveOwnModel(userId, config);
  return jsonOk({ models: (await listOwnModels(userId)).map(view) });
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
