/**
 * The model a user brings to power Loki — read, save, change, remove.
 *
 *   GET    → { available, current: { vendor, model, keyHint, verifiedAt } | null }
 *   PUT    { vendor, model, apiKey? } → saves; apiKey omitted = change model, keep key
 *   DELETE → forgets the key
 *
 * The key is never returned by any method; `keyHint` ("…abcd") is all a client
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
  getOwnModel,
  getOwnModelSummary,
  ownModelSealSecret,
  saveOwnModel,
  setOwnModelChoice,
  type OwnModelSummary,
} from "@/db/queries/user-model-keys";

export const runtime = "nodejs";

const NOT_SET_UP =
  "Connecting your own model isn't switched on for this server yet — Loki keeps using its free models.";

function view(summary: OwnModelSummary | null) {
  return summary
    ? {
        vendor: summary.vendor,
        model: summary.model,
        keyHint: summary.keyHint,
        verifiedAt: summary.verifiedAt.toISOString(),
      }
    : null;
}

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  return jsonOk({
    available: ownModelSealSecret() !== null,
    current: view(await getOwnModelSummary(userId)),
  });
}

const PutBody = z.object({
  vendor: z.enum(BYOK_VENDOR_IDS as [ByokVendorId, ...ByokVendorId[]]),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().min(8).max(400).optional(),
});

export async function PUT(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  if (!ownModelSealSecret()) return jsonError(NOT_SET_UP, 503);
  // Saving probes the vendor, so it shares the probe's allowance.
  if (!checkRateLimit(`own-model:${userId}`, 20, 10 * 60_000)) {
    return jsonError("Too many attempts — wait a few minutes and try again.", 429);
  }
  const body = await readJsonBody(req, PutBody);
  if (body instanceof NextResponse) return body;

  // Change the model on the key already stored: no key in the request.
  if (!body.apiKey) {
    const stored = await getOwnModel(userId);
    if (!stored || stored.vendor !== body.vendor) {
      return jsonError("Paste your key for this provider first.", 400);
    }
    const probe = await probeByokKey(stored.vendor, stored.apiKey);
    if (!probe.ok) return jsonError(probe.message, 400, { status: probe.status });
    if (probe.models.length > 0 && !probe.models.includes(body.model)) {
      return jsonError(`Your key can't use ${body.model}. Pick one from the list.`, 400);
    }
    return jsonOk({ current: view(await setOwnModelChoice(userId, body.model)) });
  }

  const config = { vendor: body.vendor, model: body.model, apiKey: body.apiKey };
  if (!isByokConfig(config)) return jsonError("That doesn't look like a key.", 400);

  // Never trust a client's "it worked": the key is checked again, here, before
  // it is stored — a saved key that does not work is a chat that fails later
  // with nobody knowing why.
  const probe = await probeByokKey(config.vendor, config.apiKey);
  if (!probe.ok) return jsonError(probe.message, 400, { status: probe.status });
  if (probe.models.length > 0 && !probe.models.includes(config.model)) {
    return jsonError(`Your key can't use ${config.model}. Pick one from the list.`, 400);
  }
  return jsonOk({ current: view(await saveOwnModel(userId, config)) });
}

export async function DELETE() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  await deleteOwnModel(userId);
  return jsonOk({ current: null });
}
