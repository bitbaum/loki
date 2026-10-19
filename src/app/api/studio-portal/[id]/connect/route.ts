import { NextRequest } from "next/server";
import { z } from "zod";
import { appUrl } from "@/lib/email";
import { studioBearer, studioOriginAllowed } from "@/lib/studio/access";
import {
  studioPreflight,
  studioRateAllowed,
  studioResponse,
  studioError,
  studioFailure,
} from "@/lib/studio/http";
import { studioConnectableApplication } from "@/db/queries/studio-requests";
import { studioConnectPath } from "@/lib/studio/orangecat-link";

export const OPTIONS = studioPreflight;
type Context = { params: Promise<{ id: string }> };

/**
 * An approved partner's portal asks for a link to connect OrangeCat. The
 * private key is checked here, once; the link it gets back carries only a
 * short-lived signed id, so the key never travels to Loki's sign-in pages.
 */
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
    const row = await studioConnectableApplication(id, key);
    if (!row) return studioError(request, "This portal link is unavailable.", 404);
    return studioResponse(request, { url: `${appUrl()}${studioConnectPath(row.id)}` });
  } catch (error) {
    return studioFailure(request, error);
  }
}
