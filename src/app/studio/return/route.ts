import { NextRequest, NextResponse } from "next/server";
import { studioReturnUrl } from "@/lib/studio/access";

/**
 * GET /studio/return?to=/builders/ — the studio site's sign-in door.
 *
 * Not on the proxy's public list, so a visitor without a session signs in
 * first and comes back here; a signed-in one goes straight on, to the page of
 * bitbaum.orangecat.ch they came from. Sign-in itself only ever returns to
 * Loki's own origin, so this hop is what carries a person back to the studio.
 *
 * `to` is a path on the studio site and nothing else (lib/studio/access.ts):
 * the origin is fixed, so this cannot be made to redirect anywhere else.
 */
export function GET(request: NextRequest) {
  return NextResponse.redirect(studioReturnUrl(request.nextUrl.searchParams.get("to")), 303);
}
