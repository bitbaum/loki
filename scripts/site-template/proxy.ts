import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { contentSecurityPolicy, newNonce } from "./lib/security";

const handleI18nRouting = createMiddleware(routing);

/**
 * Every page request gets two things here:
 *
 *  1. A language. `/de/account` renders German; `/` redirects to the reader's.
 *  2. A Content-Security-Policy with a fresh nonce, so the browser runs only
 *     scripts this response vouched for — Next's own, carrying the nonce.
 *
 * Next reads the nonce from the REQUEST's CSP header and stamps it on its own
 * scripts, so the policy is forwarded on the request as well as set on the
 * response. next-intl builds its own response, so the request headers are
 * forwarded with Next's override mechanism rather than NextResponse.next().
 *
 * Nothing here reads, logs or stores anything about the person.
 */
export default function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, {
    dev: process.env.NODE_ENV === "development",
    widget: Boolean(process.env.NEXT_PUBLIC_FC_WIDGET_TOKEN),
  });

  const response = handleI18nRouting(request);

  const overridden = response.headers.get("x-middleware-override-headers");
  const names = new Set(overridden ? overridden.split(",") : []);
  if (!overridden) {
    // Next replaces the request's headers with exactly the overridden list,
    // so the first override has to carry every original header along.
    request.headers.forEach((value, key) => {
      names.add(key);
      response.headers.set(`x-middleware-request-${key}`, value);
    });
  }
  for (const [key, value] of [
    ["content-security-policy", csp],
    ["x-nonce", nonce],
  ] as const) {
    names.add(key);
    response.headers.set(`x-middleware-request-${key}`, value);
  }
  response.headers.set("x-middleware-override-headers", [...names].join(","));
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // `icon` is the generated tab and install icon (app/icon.tsx, /icon/192):
      // a file with no extension that i18n routing would otherwise send to
      // /en/icon/192, where it does not exist.
      source: "/((?!api|icon|_next/static|_next/image|_vercel|.*\\..*).*)",
      // A prefetch is not rendered for a reader and needs no nonce.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
