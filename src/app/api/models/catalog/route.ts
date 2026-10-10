/**
 * GET /api/models/catalog[?refresh=1] — the model store's data: every vendor
 * a person can bring, their live models and prices (OpenRouter's public
 * catalogue, cached an hour), and which of them this person has connected.
 *
 * `refresh=1` is the "Check for new models" button: it re-reads the
 * catalogue now. Rate-limited per user — it is one outbound request to a
 * public API, but a button that can be held down is a button that will be.
 */
import type { NextRequest } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { listOwnModels } from "@/db/queries/user-model-keys";
import { fetchStoreCatalog } from "@/lib/models/store-catalog";
import { MODEL_STORE_VENDORS } from "@/config/model-store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  if (refresh && !checkRateLimit(`model-store-refresh:${userId}`, 6, 10 * 60_000)) {
    return jsonError("Checked a moment ago — try again in a few minutes.", 429);
  }
  const [catalog, own] = await Promise.all([
    fetchStoreCatalog({ refresh }),
    listOwnModels(userId).catch(() => []),
  ]);
  const connected = new Map(own.map((m) => [m.vendor, m]));
  return jsonOk({
    fetchedAt: catalog?.fetchedAt ?? null,
    vendors: MODEL_STORE_VENDORS.map((v) => {
      const live = catalog?.vendors.find((c) => c.id === v.id);
      const mine = connected.get(v.id);
      return {
        ...v,
        connected: mine ? { model: mine.model, startsHere: own[0]?.vendor === v.id } : null,
        featured: live?.featured ?? [],
        all: live?.all ?? [],
        recentCount: live?.recentCount ?? 0,
      };
    }),
  });
}
