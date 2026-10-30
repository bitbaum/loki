import { NextResponse } from "next/server";
import { requestToken, x1Enabled } from "@/lib/x-oauth1";
import { APP_URL } from "@/config/brand";
import { logDebug } from "@/db/queries/debug-logs";
import { getEnabledAuthProviders } from "@/lib/auth-providers";

// Step 1 of "Sign in with X" (OAuth 1.0a): get a request token and hand the
// user off to X's authenticate page. The token secret is stashed in a
// short-lived httpOnly cookie for the callback to finish the exchange.
export const runtime = "nodejs";

export async function GET() {
  // Paused providers (lib/auth-providers.ts) stay closed even when typed in directly.
  if (!x1Enabled() || !getEnabledAuthProviders().x) {
    return NextResponse.redirect(`${APP_URL}/sign-in?error=XLoginUnavailable`);
  }
  try {
    const callbackUrl = `${APP_URL}/api/x-login/callback`;
    const { oauth_token, oauth_token_secret } = await requestToken(callbackUrl);
    const res = NextResponse.redirect(
      `https://api.x.com/oauth/authenticate?oauth_token=${encodeURIComponent(oauth_token)}`,
    );
    res.cookies.set("x1_req_secret", oauth_token_secret, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return res;
  } catch (e) {
    await logDebug({
      source: "x-login.start",
      level: "error",
      message: (e as Error)?.message ?? String(e),
      meta: {},
    }).catch(() => {});
    return NextResponse.redirect(`${APP_URL}/sign-in?error=XLoginStart`);
  }
}
