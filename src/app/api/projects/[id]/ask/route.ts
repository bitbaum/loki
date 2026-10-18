import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { askInLoki } from "@/lib/feedback/ask-in-loki";

/**
 * POST /api/projects/[id]/ask — someone on the project asks for a change from
 * its page in Loki (lib/feedback/ask-in-loki.ts says why and what happens).
 * Access is the project's own rule: the owner and members only.
 */
const Body = z.object({ text: z.string().trim().min(1).max(2000) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Sign in first.", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  if (!checkRateLimit(`project-ask:${userId}`, 60, RATE_LIMIT_WINDOW_LONG_MS)) {
    return jsonError("That is a lot in one hour — try again in a while.", 429);
  }
  const result = await askInLoki({ userId, projectId: idOrResp, text: body.text });
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk({
    building: result.building,
    say: result.say,
    followPath: result.followPath,
  });
}
