import { NextResponse } from "next/server";
import { COMMISSION } from "@/config/commission";

/**
 * GET /studio-private — the sign-in door for bitbaum's private projects area.
 *
 * Not on the proxy's public list, so a visitor without a session is sent to
 * sign in first and comes back here; a signed-in one goes straight on. The
 * destination is fixed, so this is not an open redirect.
 */
export function GET() {
  return NextResponse.redirect(`${COMMISSION.studioOrigin}/private/`, 303);
}
