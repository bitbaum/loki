/**
 * The models a user brings to power Loki — list, add or replace, change,
 * re-order, remove. One key per vendor; the order is the user's own chain.
 *
 *   GET    → { available, models: [{ vendor, model, keyHint, verifiedAt, position, baseUrl, label }],
 *              usage: [{ vendor, tokensToday, callsToday, tokens30d, calls30d }], billing }
 *   PUT    { vendor, model, apiKey? } → adds or replaces that vendor's key;
 *                                       apiKey omitted = change model, keep key
 *   PUT    { vendor: "custom", baseUrl, model, apiKey?, label? } → the person's own
 *                                       endpoint (lib/models/endpoint-guard.ts gates the URL);
 *                                       baseUrl omitted = change model, keep it
 *   PATCH  { order: [vendor, …] }     → re-order the chain
 *   DELETE { vendor }                 → forgets that vendor's key
 *
 * A key is never returned by any method; `keyHint` ("…abcd") is all a client
 * ever sees. Checking a key WITHOUT saving it is ./probe.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CUSTOM_VENDOR_ID,
  VENDOR_IDS,
  isOwnKeyConfig,
  vendorById,
  type VendorId,
} from "@/config/model-vendors";
import { probeOwnKey } from "@/lib/models/probe";
import { ENDPOINT_MAX_LENGTH, parseEndpoint } from "@/lib/models/endpoint-guard";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { ownModelVerdict } from "@/lib/own-model-verdict";
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

const Vendor = z.enum(VENDOR_IDS as [VendorId, ...VendorId[]]);

function view(summary: OwnModelSummary) {
  return {
    vendor: summary.vendor,
    model: summary.model,
    keyHint: summary.keyHint,
    verifiedAt: summary.verifiedAt.toISOString(),
    position: summary.position,
    baseUrl: summary.baseUrl,
    label: summary.label,
  };
}

/** Where each vendor's bill and spending cap live — what the screen links to beside a key. */
const BILLING = Object.fromEntries(
  VENDOR_IDS.map((id) => {
    const v = vendorById(id)!;
    return [id, { billingUrl: v.billingUrl, limit: v.limit }];
  }),
);

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
    billing: BILLING,
  });
}

const PutBody = z.object({
  vendor: Vendor,
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().max(400).optional(),
  /** Only for `custom`: the person's own host. Its presence means "add or replace". */
  baseUrl: z.string().trim().max(ENDPOINT_MAX_LENGTH).optional(),
  label: z.string().trim().max(60).optional(),
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

  const custom = body.vendor === CUSTOM_VENDOR_ID;
  const adding = custom ? body.baseUrl !== undefined : Boolean(body.apiKey);
  if (!adding) {
    const changed = await setOwnModelChoice(userId, body.vendor, body.model);
    if (!changed) {
      return jsonError(
        custom ? "Add your endpoint first." : "Paste your key for this provider first.",
        400,
      );
    }
    return jsonOk({ models: (await listOwnModels(userId)).map(view) });
  }

  let baseUrl: string | undefined;
  if (custom) {
    const verdict = parseEndpoint(body.baseUrl ?? "");
    if (!verdict.ok) return jsonError(verdict.reason, 400);
    baseUrl = verdict.baseUrl;
  }
  const config = {
    vendor: body.vendor,
    apiKey: body.apiKey ?? "",
    model: body.model,
    ...(custom ? { baseUrl, label: body.label } : {}),
  };
  if (!isOwnKeyConfig(config)) return jsonError("That key or model id is not valid.", 400);
  // Saved once the vendor KNOWS the key. A key it refuses is not stored, and
  // the vendor's own words say why. A key it knows but cannot bill yet (no
  // credits, a spending limit) IS stored — the account is one top-up away
  // from working, and refusing it was a wall (xAI, 2026-10-10).
  const probe = await probeOwnKey(config);
  const verdict = ownModelVerdict(probe);
  // An endpoint that cannot be reached is the person's URL, not a vendor
  // outage: say so as a 400 with the guard's or the network's sentence.
  if (verdict === "unreachable") return jsonError(probe.message, custom ? 400 : 502);
  if (verdict === "refused") return jsonError(probe.message, 400);
  await saveOwnModel(userId, config);
  const vendor = vendorById(config.vendor)!;
  return jsonOk({
    models: (await listOwnModels(userId)).map(view),
    ...(verdict === "unfunded"
      ? {
          unfunded: {
            message: probe.message,
            billing: { billingUrl: vendor.billingUrl, limit: vendor.limit },
          },
        }
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
