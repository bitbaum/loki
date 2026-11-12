import type { NextAuthConfig } from "next-auth";
import { ROUTES } from "@/config/auth";
import { DEMO_DENIAL_COPY, demoDenialFor, isDemoEmail, isDemoEnabled } from "@/config/demo";
import { tokenSessionDenial } from "@/lib/auth/token-session";

function sessionOnboardingDone(user: {
  onboardingComplete?: boolean;
  onboardedAt?: Date | string | null;
  username?: string | null;
}): boolean {
  if (user.onboardingComplete === true) return true;
  return Boolean(user.onboardedAt && user.username);
}

// Edge-safe auth config — no DB adapter, no Node.js crypto.
// Used by src/middleware.ts (Edge Runtime).
// Full auth with DB adapter lives in src/auth.ts.
export const authConfig = {
  session: { strategy: "jwt" } as const,
  pages: {
    signIn: ROUTES.SIGN_IN,
  },
  providers: [],
  callbacks: {
    // Propagate onboardedAt from the JWT payload so the authorized callback below
    // can gate unonboarded users to the /onboarding page without a DB lookup.
    // The jwt() callback in auth.ts stores this field on every sign-in/token refresh.
    session({ session, token }) {
      if (session.user) {
        // Copied EXPLICITLY rather than relying on NextAuth's default population:
        // the demo gate below keys off this field, and a gate that reads
        // undefined fails OPEN — the demo account would silently get the run of
        // the box. An explicit assignment makes that impossible to lose to a
        // future change in provider or adapter defaults.
        session.user.email = (token.email as string | null | undefined) ?? session.user.email;
        session.user.username = (token.username as string | null) ?? null;
        session.user.onboardedAt = (token.onboardedAt as Date | null) ?? null;
        session.user.onboardingComplete = token.onboardingComplete === true;
        // Derived from the JWT's own email claim, which NextAuth always sets,
        // rather than from session.user.email — see the note on Session.user
        // in src/auth.ts. The demo gate below reads this and nothing else.
        session.user.isDemo = isDemoEmail(token.email);
      }
      return session;
    },
    authorized({ auth, request }) {
      const { pathname, search } = request.nextUrl;

      // Invitation token routes must be publicly accessible so unauthenticated
      // users can accept team invitations. startsWith is used rather than a
      // regex because the edge runtime's regex engine does not reliably evaluate
      // complex lookahead patterns at compile time.
      if (pathname.startsWith("/api/invitations/")) return true;

      // "Sign in with X" (OAuth 1.0a) endpoints + the completion page must be
      // reachable while unauthenticated — they ARE the sign-in. See
      // src/app/api/x-login/* and src/app/x-login/complete.
      if (pathname.startsWith("/api/x-login/")) return true;
      if (pathname.startsWith("/x-login/")) return true;

      if (!auth?.user) {
        // Bearer-authenticated requests (ck_* agent tokens preferred; legacy
        // runner env token honored only when explicitly opted in). Individual
        // routes enforce the real auth check via getApiUserId/getBearerUserId.
        const authHeader = request.headers.get("authorization") ?? "";
        if (authHeader.startsWith("Bearer ck_")) return true;
        // Edge runtime — inline the alias logic instead of importing to keep the bundle tiny.
        const daemonToken =
          process.env.APP_DAEMON_TOKEN ??
          process.env.LOKI_DAEMON_TOKEN ??
          process.env.COCKPIT_DAEMON_TOKEN;
        const legacyAllowed =
          (process.env.APP_ALLOW_LEGACY_DAEMON_TOKEN ??
            process.env.LOKI_ALLOW_LEGACY_DAEMON_TOKEN ??
            process.env.COCKPIT_ALLOW_LEGACY_DAEMON_TOKEN) === "1";
        if (legacyAllowed && daemonToken && authHeader === `Bearer ${daemonToken}`) return true;

        // The app runs behind Caddy on a single known host
        // (loki.orangecat.ch). x-forwarded-host carries the real host the
        // user typed, which we prefer over the internal request host.
        const host = request.headers.get("x-forwarded-host") ?? request.nextUrl.host;
        const proto =
          request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
        const signInUrl = new URL(ROUTES.SIGN_IN, `${proto}://${host}`);
        if (pathname !== ROUTES.SIGN_IN) {
          signInUrl.searchParams.set("callbackUrl", pathname + search);
        }
        // API routes must not redirect — callers expect JSON 401.
        if (pathname.startsWith("/api/")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        return Response.redirect(signInUrl);
      }

      // Redirect authenticated-but-not-onboarded users to the onboarding flow.
      // API routes are excluded so onboarding page API calls (/api/me, /api/user-projects)
      // work normally. Sign-out is excluded to avoid a redirect loop on logout.
      // Gate until onboarding is complete in JWT (refreshed from DB on sign-in / session.update).
      const onboardingDone = sessionOnboardingDone(auth.user);
      if (
        !onboardingDone &&
        !pathname.startsWith(ROUTES.ONBOARDING) &&
        // A note's tracking link claims the note for a new account before
        // onboarding (ClaimFeedback), as the old sign-up form did by hand.
        !pathname.startsWith("/claim-feedback") &&
        !pathname.startsWith("/api/") &&
        !pathname.startsWith(ROUTES.SIGN_OUT)
      ) {
        const host = request.headers.get("x-forwarded-host") ?? request.nextUrl.host;
        const proto =
          request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
        return Response.redirect(new URL(ROUTES.ONBOARDING, `${proto}://${host}`));
      }

      // Demo sandbox (layer 1 — see src/config/demo.ts). Every authenticated
      // request already passes through here, which makes this the one place a
      // route family can be denied without asking each handler to remember.
      // Effect-level asserts in src/lib/demo-guard.ts back it up, so a mistake
      // in the path list below still cannot reach the box.
      if (isDemoEnabled() && auth.user.isDemo) {
        // Every denied prefix is an /api path, so a JSON 403 is the only shape
        // this can return — no page-redirect branch, because there is no page
        // it could fire on. Server actions POST to page paths and are therefore
        // NOT gated here; that is what the layer-2 effect asserts are for.
        const reason = demoDenialFor(pathname, request.method);
        if (reason) {
          return new Response(
            JSON.stringify({ error: DEMO_DENIAL_COPY[reason], demoBlocked: true, reason }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }
      }

      // A session opened with an agent's token never reaches a credential, a
      // shell or the account's export (lib/auth/token-session.ts). Writes
      // through person-only routes are refused in lib/session.ts.
      if (auth.user.viaToken && pathname.startsWith("/api/")) {
        const denied = tokenSessionDenial(pathname);
        if (denied) {
          return new Response(JSON.stringify({ error: denied, tokenSession: true }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
