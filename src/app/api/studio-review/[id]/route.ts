import { NextRequest } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/session";
import { StudioStaffAction } from "@/config/studio";
import { readStudioBody } from "@/lib/studio/body";
import { studioResponse, studioError, studioFailure } from "@/lib/studio/http";
import { getStudioReview, mutateStudioReview } from "@/db/queries/studio-requests";
import { getStudioCommission } from "@/lib/studio-commission";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  const userId = await getApiUserId();
  if (!userId) return studioError(request, "Unauthorized", 401);
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return studioError(request, "Invalid request id.", 400);
  try {
    const view = await getStudioReview(userId, id);
    return view
      ? studioResponse(request, { request: view })
      : studioError(request, "Request not found.", 404);
  } catch (error) {
    return studioFailure(request, error);
  }
}
export async function POST(request: NextRequest, context: Context) {
  const userId = await getApiUserId();
  if (!userId) return studioError(request, "Unauthorized", 401);
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return studioError(request, "Invalid request id.", 400);
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin)
    return studioError(request, "This origin is not allowed.", 403);
  try {
    const parsed = StudioStaffAction.safeParse(await readStudioBody(request));
    if (!parsed.success)
      return studioError(request, parsed.error.issues[0]?.message ?? "Check this action.", 400);
    const contract = ["review_course", "approve_partner"].includes(parsed.data.action)
      ? await getStudioCommission()
      : null;
    const saved = await mutateStudioReview(userId, id, parsed.data, contract);
    return saved ? studioResponse(request, {}) : studioError(request, "Request not found.", 404);
  } catch (error) {
    return studioFailure(request, error);
  }
}
