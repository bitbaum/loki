import { NextRequest } from "next/server";
import { z } from "zod";
import { StudioGuestAction } from "@/config/studio";
import { readStudioBody } from "@/lib/studio/body";
import { studioBearer, studioOriginAllowed } from "@/lib/studio/access";
import {
  studioPreflight,
  studioRateAllowed,
  studioResponse,
  studioError,
  studioFailure,
} from "@/lib/studio/http";
import { getStudioPortal, mutateStudioPortal } from "@/db/queries/studio-requests";
import { notifyStudioActivity } from "@/lib/studio/notify";
import { mailStudioLink } from "@/lib/studio/link-mail";
import { getStudioCommission } from "@/lib/studio-commission";
export const OPTIONS = studioPreflight;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  const key = studioBearer(request);
  const { id } = await context.params;
  if (!key || !z.uuid().safeParse(id).success)
    return studioError(
      request,
      "This portal link is unavailable. Open the complete saved link or contact the studio.",
      404,
    );
  if (!studioRateAllowed(request, "portal-read"))
    return studioError(request, "Please retry shortly.", 429);
  try {
    const view = await getStudioPortal(id, key);
    return view
      ? studioResponse(request, view)
      : studioError(
          request,
          "This portal link is unavailable. Open the complete saved link or contact the studio.",
          404,
        );
  } catch (error) {
    return studioFailure(request, error);
  }
}
export async function POST(request: NextRequest, context: Context) {
  const key = studioBearer(request);
  const { id } = await context.params;
  if (!key || !z.uuid().safeParse(id).success)
    return studioError(request, "This portal link is unavailable.", 404);
  if (!studioOriginAllowed(request))
    return studioError(request, "This origin is not allowed.", 403);
  if (!studioRateAllowed(request, "portal-write", 30))
    return studioError(request, "Please retry shortly.", 429);
  try {
    const parsed = StudioGuestAction.safeParse(await readStudioBody(request));
    if (!parsed.success)
      return studioError(request, parsed.error.issues[0]?.message ?? "Check this action.", 400);
    const contract =
      parsed.data.action === "submit_assessment" ? await getStudioCommission() : null;
    const saved = await mutateStudioPortal(id, key, parsed.data, contract);
    if (!saved) return studioError(request, "This portal link is unavailable.", 404);
    if (!saved.replay) {
      void notifyStudioActivity(saved.row, parsed.data.action, saved.body);
      if (parsed.data.action === "set_contact")
        mailStudioLink({ to: parsed.data.contact, id, accessKey: key, kind: saved.row.kind });
    }
    return studioResponse(request, {});
  } catch (error) {
    return studioFailure(request, error);
  }
}
