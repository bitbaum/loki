import { NextResponse } from "next/server";
import { studioReturnUrl } from "@/lib/studio/access";

/**
 * GET /studio/left — where a sign-out that began on the studio site ends.
 *
 * Public: the person has just signed out, so there is no session to ask for.
 * The destination is the studio's home page and nothing else.
 */
export function GET() {
  return NextResponse.redirect(studioReturnUrl("/"), 303);
}
