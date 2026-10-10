/**
 * GET /api/models/catalog[?refresh=1] — the model store's data: every chat
 * model OpenRouter's public catalogue lists (cached an hour), the labs behind
 * them, and which keys this person holds.
 *
 * `refresh=1` is the "Check for new models" button: it re-reads the
 * catalogue now. Rate-limited per user — it is one outbound request to a
 * public API, but a button that can be held down is a button that will be.
 */
import type { NextRequest } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { storeDataFor } from "@/lib/models/store-data";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  if (refresh && !checkRateLimit(`model-store-refresh:${userId}`, 6, 10 * 60_000)) {
    return jsonError("Checked a moment ago — try again in a few minutes.", 429);
  }
  return jsonOk(await storeDataFor(userId, refresh));
}
