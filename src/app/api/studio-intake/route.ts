import { NextRequest } from "next/server";
import { StudioIntake } from "@/config/studio";
import { readStudioBody } from "@/lib/studio/body";
import { studioOriginAllowed } from "@/lib/studio/access";
import {
  studioPreflight,
  studioRateAllowed,
  studioContext,
  studioResponse,
  studioError,
  studioFailure,
} from "@/lib/studio/http";
import { createStudioRequest } from "@/db/queries/studio-requests";
import { notifyStudioActivity } from "@/lib/studio/notify";
export const OPTIONS = studioPreflight;
/** Public write-only intake. Owner is fixed by the studio contract, never by caller input. */
export async function POST(request: NextRequest) {
  if (!studioOriginAllowed(request, true))
    return studioError(request, "Submit through the Bitbaum studio website.", 403);
  if (!studioRateAllowed(request, "intake", 10))
    return studioError(request, "Too many requests. Try again shortly.", 429);
  try {
    const parsed = StudioIntake.safeParse(await readStudioBody(request));
    if (!parsed.success)
      return studioError(request, parsed.error.issues[0]?.message ?? "Check your brief.", 400);
    if (parsed.data.company)
      return studioError(request, "This request could not be accepted.", 400);
    const { token, contract } = await studioContext();
    const { fresh, ...saved } = await createStudioRequest(token, contract, parsed.data);
    // Persist first, announce second: a replayed receipt was announced when it
    // was first saved, and a notify hiccup can never fail the ingest.
    if (fresh) void notifyStudioActivity(fresh, "received", fresh.changes);
    return studioResponse(request, saved);
  } catch (error) {
    return studioFailure(request, error);
  }
}
