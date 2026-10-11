import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readJsonBody } from "@/lib/api/route-helpers";
import { recordUsageEvents } from "@/db/queries/operator-usage";
import { USAGE_LIMITS, USAGE_SURFACE_IDS, allowsUsageAction } from "@/config/usage-surfaces";

const UsageEvent = z.object({
  surface: z.string().min(1).max(64),
  action: z.string().min(1).max(32),
  target: z.string().max(USAGE_LIMITS.target).nullable().optional(),
  path: z.string().max(USAGE_LIMITS.path).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const UsageBody = z.object({
  events: z.array(UsageEvent).min(1).max(USAGE_LIMITS.batch),
});

/**
 * POST /api/usage — the operator did something with a surface Loki built.
 * Every (surface, action) must be in src/config/usage-surfaces.ts; the rest
 * of the body is bounded and stored as-is. `{ ok: true, recorded: n }`.
 */
export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const dataOrResp = await readJsonBody(req, UsageBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  for (const e of dataOrResp.events) {
    if (!allowsUsageAction(e.surface, e.action)) {
      return jsonError(
        `Unknown usage event ${e.surface}/${e.action}. Surfaces: ${USAGE_SURFACE_IDS.join(", ")} (src/config/usage-surfaces.ts).`,
        400,
      );
    }
    if (e.meta && JSON.stringify(e.meta).length > USAGE_LIMITS.metaChars) {
      return jsonError(`meta exceeds ${USAGE_LIMITS.metaChars} characters`, 400);
    }
  }

  const recorded = await recordUsageEvents(
    userId,
    dataOrResp.events.map((e) => ({
      surface: e.surface,
      action: e.action,
      target: e.target ?? null,
      path: e.path ?? null,
      meta: e.meta ?? null,
    })),
  );
  return jsonOk({ recorded }, { status: 201 });
}
