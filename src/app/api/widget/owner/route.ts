import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { resolveProjectPublicOrigin } from "@/lib/feedback/project-site";
import {
  createOwnerPass,
  ownerReturnUrl,
  ownerSiteUrl,
  OWNER_DENIED_HASH,
} from "@/lib/feedback/owner-pass";
import { WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { appUrl } from "@/lib/email";

/**
 * "This is my site — let Loki watch", from inside the widget.
 *
 * Until this route the owner pass reached a browser one way only: the "Open
 * your site" link on the project page in Loki. An owner who simply visited
 * their own site — the normal case — got a widget that treated them as a
 * stranger, with Watch nowhere to be found. Now the widget links here; Loki's
 * own session says who they are (the proxy signs them in first, and brings
 * them back), and if they own the widget's project they return to the page
 * they were on with the pass in the fragment and Watch on.
 *
 * Top-level navigation, not a fetch: Loki's session cookie is first-party
 * here, so no third-party cookie and no CORS are involved. The return URL must
 * be on the project's own site, or the pass would be handed to whoever wrote
 * the link (see ownerReturnUrl).
 */
export async function GET(req: NextRequest) {
  const tokenParam = req.nextUrl.searchParams.get("token") ?? "";
  const returnParam = req.nextUrl.searchParams.get("return");

  const userId = await getApiUserId();
  if (!userId) {
    const signIn = new URL("/sign-in", appUrl());
    signIn.searchParams.set("redirect_url", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signIn);
  }

  const token = tokenParam.startsWith("fcw_") ? await getWidgetTokenByToken(tokenParam) : null;
  if (!token || token.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return NextResponse.json({ error: "Unknown or paused widget" }, { status: 404 });
  }
  const siteOrigin = await resolveProjectPublicOrigin(token.userId, token.projectId);
  const allowed = [...(token.origins ?? []), ...(siteOrigin ? [siteOrigin] : [])];
  const back = ownerReturnUrl(returnParam, allowed);
  if (!back) {
    return NextResponse.json({ error: "That page is not on this project's site" }, { status: 400 });
  }

  // Signed in, but not as the person whose widget this is: say so on the site
  // they came from rather than leaving them on an error page in Loki.
  if (token.userId !== userId) {
    return NextResponse.redirect(`${back.split("#")[0]}#${OWNER_DENIED_HASH}`);
  }
  return NextResponse.redirect(ownerSiteUrl(back, createOwnerPass(token.projectId, userId)));
}
