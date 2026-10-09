import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { getWidgetProjectKey, getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { getProjectAccess } from "@/db/queries/project-access";
import { resolveProjectPublicOrigin } from "@/lib/feedback/project-site";
import { ownerReturnUrl, OWNER_DENIED_HASH } from "@/lib/feedback/owner-pass";
import { WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { appUrl } from "@/lib/email";
import {
  CONTINUE_TEXT_MAX,
  CONTINUE_VIEWS,
  continueHref,
  type ContinueView,
} from "@/lib/widget/continue";

/**
 * "Continue in Loki", from inside the widget on someone's live site.
 *
 * The panel is where the owner first says what they want; developing it
 * happens here — in the chat on their project, with what they said in the
 * composer, or in the project's terminal. The widget only holds a token, so
 * this route is where the token becomes a project and the person becomes a
 * Loki user: it signs them in if needed (and brings them back), checks they
 * may work on the widget's project, and redirects.
 *
 * Same shape as /api/widget/owner, for the same reasons: a top-level
 * navigation (Loki's cookie is first-party here, no CORS), and a person who
 * turns out not to own the site is sent back to the page they came from with
 * `#loki-owner-denied`, never left on a JSON error — provided that page is on
 * the project's own site (`ownerReturnUrl`).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const tokenParam = params.get("token") ?? "";
  const viewParam = params.get("view");
  const view: ContinueView = CONTINUE_VIEWS.find((v) => v === viewParam) ?? "chat";
  const text = (params.get("q") ?? "").slice(0, CONTINUE_TEXT_MAX);

  const userId = await getApiUserId();
  if (!userId) {
    const signIn = new URL("/sign-in", appUrl());
    signIn.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signIn);
  }

  const token = tokenParam.startsWith("fcw_") ? await getWidgetTokenByToken(tokenParam) : null;
  if (!token || token.status !== WIDGET_TOKEN_STATUS.ACTIVE) {
    return NextResponse.json({ error: "Unknown or paused widget" }, { status: 404 });
  }

  const access = await getProjectAccess(userId, token.projectId);
  if (!access) {
    const siteOrigin = await resolveProjectPublicOrigin(token.userId, token.projectId);
    const allowed = [...(token.origins ?? []), ...(siteOrigin ? [siteOrigin] : [])];
    const back = ownerReturnUrl(params.get("return"), allowed);
    if (back) return NextResponse.redirect(`${back.split("#")[0]}#${OWNER_DENIED_HASH}`);
    return NextResponse.json({ error: "This site is not one of your projects" }, { status: 403 });
  }

  const key = await getWidgetProjectKey(token.projectId, access.ownerUserId);
  if (!key)
    return NextResponse.json({ error: "This widget's project no longer exists" }, { status: 404 });
  return NextResponse.redirect(`${appUrl()}${continueHref(key, view, text)}`);
}
