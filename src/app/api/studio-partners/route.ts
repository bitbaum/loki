import { NextRequest } from "next/server";
import { studioPartnerDirectory } from "@/db/queries/studio-requests";
import {
  studioPreflight,
  studioRateAllowed,
  studioContext,
  studioResponse,
  studioError,
  studioFailure,
} from "@/lib/studio/http";
export const OPTIONS = studioPreflight;
/** Public directory includes only approved, consenting, published, available profiles. */
export async function GET(request: NextRequest) {
  if (!studioRateAllowed(request, "directory"))
    return studioError(request, "Please retry shortly.", 429);
  try {
    const { token } = await studioContext();
    return studioResponse(request, { partners: await studioPartnerDirectory(token.userId) });
  } catch (error) {
    return studioFailure(request, error);
  }
}
