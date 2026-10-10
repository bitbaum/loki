/**
 * POST { vendor, apiKey?, baseUrl? } → "does this key work, and what can it use?"
 *
 * Nothing is stored. The settings screen calls this the moment a key is
 * pasted, so it can say whether the key works and offer the models it can
 * reach with the best one preselected (lib/models/probe.ts). With no apiKey
 * it probes the key already stored for that vendor — so changing model never
 * means pasting the key again.
 *
 * Server-side because vendors refuse browser-origin calls, and because the
 * hosts it may contact are Loki's closed vendor list — with ONE exception,
 * the person's own endpoint, whose URL arrives here and passes
 * lib/models/endpoint-guard.ts before a byte is sent. Rate-limited per user:
 * it makes one or two outbound calls per request.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { CUSTOM_VENDOR_ID, VENDOR_IDS, vendorById, type VendorId } from "@/config/model-vendors";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOwnModelKey } from "@/db/queries/user-model-keys";
import { ownModelVerdict } from "@/lib/own-model-verdict";
import { probeOwnKey } from "@/lib/models/probe";
import { ENDPOINT_MAX_LENGTH } from "@/lib/models/endpoint-guard";

export const runtime = "nodejs";

const Body = z.object({
  vendor: z.enum(VENDOR_IDS as [VendorId, ...VendorId[]]),
  apiKey: z.string().trim().max(400).optional(),
  baseUrl: z.string().trim().max(ENDPOINT_MAX_LENGTH).optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  if (!checkRateLimit(`own-model:${userId}`, 20, 10 * 60_000)) {
    return jsonError("Too many attempts — wait a few minutes and try again.", 429);
  }
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;

  const custom = body.vendor === CUSTOM_VENDOR_ID;
  // A fresh paste carries the key (and, for an endpoint, its URL). Anything
  // else probes what is stored: the person changing model without re-pasting.
  const fresh = custom ? body.baseUrl !== undefined : Boolean(body.apiKey);
  let config: { vendor: VendorId; apiKey: string; baseUrl?: string };
  if (fresh) {
    config = { vendor: body.vendor, apiKey: body.apiKey ?? "", baseUrl: body.baseUrl };
  } else {
    const stored = await getOwnModelKey(userId, body.vendor);
    if (!stored) {
      return jsonError(
        custom ? "Add your endpoint first." : "Paste your key for this provider first.",
        400,
      );
    }
    config = stored;
  }

  const probe = await probeOwnKey(config);
  // Four states, not two: a key the vendor knows but cannot bill is
  // "unfunded", and the way forward (its billing page) rides along.
  const state = ownModelVerdict(probe);
  const vendor = vendorById(body.vendor)!;
  return jsonOk({
    works: probe.ok,
    state,
    message: probe.message,
    models: probe.models,
    suggested: probe.suggested,
    billing: { billingUrl: vendor.billingUrl, limit: vendor.limit },
  });
}
