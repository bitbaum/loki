/**
 * POST { vendor, apiKey? } → "does this key work, and what can it use?"
 *
 * Nothing is stored. The settings screen calls this the moment a key is
 * pasted, so it can say whether the key works and offer the models it can
 * reach with the best one preselected (ai-kit's probeByokKey). With no apiKey
 * it probes the key already stored for that vendor — so changing model never
 * means pasting the key again.
 *
 * Server-side because vendors refuse browser-origin calls, and because the
 * hosts it may contact are ai-kit's closed list, never a URL from the request.
 * Rate-limited per user: it makes one or two outbound calls per request.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BYOK_VENDOR_IDS, type ByokVendorId } from "@bitbaum/ai-kit/byok";
import { probeByokKey } from "@bitbaum/ai-kit/byok-probe";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOwnModel } from "@/db/queries/user-model-keys";

export const runtime = "nodejs";

const Body = z.object({
  vendor: z.enum(BYOK_VENDOR_IDS as [ByokVendorId, ...ByokVendorId[]]),
  apiKey: z.string().trim().min(8).max(400).optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  if (!checkRateLimit(`own-model:${userId}`, 20, 10 * 60_000)) {
    return jsonError("Too many attempts — wait a few minutes and try again.", 429);
  }
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;

  let apiKey = body.apiKey;
  if (!apiKey) {
    const stored = await getOwnModel(userId);
    if (!stored || stored.vendor !== body.vendor) {
      return jsonError("Paste your key for this provider first.", 400);
    }
    apiKey = stored.apiKey;
  }

  const probe = await probeByokKey(body.vendor, apiKey);
  return jsonOk({
    works: probe.ok,
    message: probe.message,
    models: probe.models,
    suggested: probe.suggested,
  });
}
