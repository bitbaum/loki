import NextAuth from "next-auth";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { authConfig } from "@/auth.config";
import { ROUTES } from "@/config/auth";
import { sharedRuntimeEnabled } from "@bitbaum/accountkit/auth/switch";
import { siteUrl } from "@/lib/auth/shared/runtime";
import { compat } from "@/lib/auth/shared/compat";
import { TOKEN_SESSION_WRITE_HEADER, isReadMethod } from "@/lib/auth/token-session";

// Edge-safe auth middleware — uses only the JWT session and the authorized()
// callback from auth.config.ts. No DB adapter, no Node.js crypto.
//
// What this activates:
//   • Unauthenticated users → redirect to /sign-in with callbackUrl
//   • Authenticated + onboarding incomplete → redirect to /onboarding
//   • Runner bearer-token requests → pass through to individual routes
//
// The matcher intentionally excludes public routes so they stay accessible
// without a session. Protected pages that need a userId also call
// requirePageUserId() as a belt-and-suspenders check.
const authJsProxy = NextAuth(authConfig).auth as unknown as (
  req: NextRequest,
  ev: NextFetchEvent,
) => Promise<Response>;

/**
 * With AUTH_RUNTIME=accountkit the session is a database row read through
 * AccountKit (docs/architecture/accountkit-migration.md), and the same
 * authorized() decides; a refusal goes to sign-in with callbackUrl, as Auth.js
 * sends it. Otherwise the Auth.js JWT, exactly as before.
 */
export default async function proxy(req: NextRequest, ev: NextFetchEvent) {
  if (!sharedRuntimeEnabled()) return authJsProxy(req, ev);
  const session = await compat.sessionFor(req.headers);
  const verdict = await authConfig.callbacks.authorized({
    auth: session,
    request: req,
  } as Parameters<typeof authConfig.callbacks.authorized>[0]);
  if (verdict instanceof Response) return verdict;
  // authorized() answers true or a redirect today; a plain false is Auth.js's "sign in".
  if ((verdict as unknown) === false) {
    const signIn = new URL(ROUTES.SIGN_IN, siteUrl());
    signIn.searchParams.set(
      "callbackUrl",
      `${siteUrl()}${req.nextUrl.pathname}${req.nextUrl.search}`,
    );
    return NextResponse.redirect(signIn);
  }
  // A write made with a token-opened session is marked for lib/session.ts,
  // which then reads it as signed out on person-only routes. The mark is the
  // proxy's alone: one sent by a client is dropped.
  const tokenWrite = Boolean(session?.user?.viaToken) && !isReadMethod(req.method);
  if (tokenWrite || req.headers.has(TOKEN_SESSION_WRITE_HEADER)) {
    const headers = new Headers(req.headers);
    headers.delete(TOKEN_SESSION_WRITE_HEADER);
    if (tokenWrite) headers.set(TOKEN_SESSION_WRITE_HEADER, "1");
    return NextResponse.next({ request: { headers } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Run on every path EXCEPT:
     *   _next/static, _next/image  – Next.js internals
     *   favicon.ico                – browser icon request
     *   icon\.svg, manifest\.json  – PWA / browser-tab static assets (including app-icons/ and sw.js)
     *   opengraph-image, twitter-image – social card crawlers (FB, Twitter, Slack, LinkedIn)
     *   robots\.txt, sitemap\.xml  – search engines
     *   rss\.xml                   – public Thoughts feed (readers fetch unauthenticated)
     *   /                          – public landing page (.+ not .*)
     *   sign-in, sign-up, claim-feedback – public auth and feedback-claim pages
     *   studio/connect, studio/partner – an approved partner connecting or
     *                                signing in with OrangeCat (they sign in on the page)
     *   studio/left                – where a sign-out begun on the studio site ends: there is
     *                                no session left to ask for. studio/return is NOT listed, on
     *                                purpose: it is the studio site's sign-in door, so the proxy
     *                                sends a signed-out visitor through /sign-in and back to it.
     *   forgot-password, reset-password, verify-email, setup, invite
     *   download                    – public install/discovery page
     *   whitepaper, thoughts       – public content
     *   docs, blog, changelog,     – public marketing surface (docs subsumes docs/quickstart)
     *   support
     *   frontier                   – daily AI/robotics frontier digest (public)
     *   no-screen                  – public marketing page for no-screen mode (the mode itself is /voice, signed in)
     *   why, how-it-works, compare – public marketing pages (mission, philosophy and
     *                                frontier now only redirect, and stay public so they can)
     *   mission, philosophy,       – public marketing pages
     *   investors, roadmap, pricing
     *   u/                         – public user profiles (/u/[username])
     *   share/project/             – unlisted read-only project dossiers
     *   share/task/                – an assignment handed to a human; the minted
     *                                token IS their credential and they have no
     *                                account by design (see config/crew.ts)
     *   a/                         – one-tap approve/reject of ONE queued action
     *                                from the operator's phone. Same rationale as
     *                                share/task/: the signed token IS the
     *                                credential, and requiring a session would
     *                                put a login between a Telegram button and a
     *                                yes/no — the entire cost this removes.
     *                                The trailing slash is load-bearing: a bare
     *                                `a` would make every path starting with
     *                                that letter public, /approvals and /api
     *                                included. See lib/actions/action-link.ts for
     *                                why one token can only decide one action.
     *   w/                         – a shared "Watch the fix" walkthrough: the signed
     *                                share token only mints a viewer ticket and
     *                                redirects to the live site (lib/feedback/tour-token.ts).
     *                                Trailing slash load-bearing, as for a/.
     *   beacon                     – public beacon page
     *   api/auth                   – NextAuth internal endpoints
     *   api/agent/install          – serves the @loki/agent CLI for curl|node install
     *                                (public so new customers can run it before they sign in)
     *   api/agent/daemon           – serves the gzipped daemon-scripts tarball for the
     *                                CLI's install step (same pre-auth rationale as /install)
     *   api/health, api/setup      – infrastructure endpoints (pre-auth)
     *   api/crons, api/system      – GET excluded for runner/monitoring; write methods enforce auth in-handler
     *   api/invitations/           – token-scoped invitation routes (GET validate, POST accept);
     *                                trailing slash keeps GET /api/invitations (list) protected
     *   api/share/task/            – the assignee's read + accept/decline/deliver, by token;
     *                                the path segment keeps every other /api/share child protected
     *   api/telegram/webhook       – Loki's notification bot; verifies Telegram's secret-token header
     *   api/orangecat/             – OrangeCat webhooks (entitlement, events, site, task, ask, actor-status, sessions, feedback); each verifies its own HMAC
     *                                signature. One exception, deliberately unsigned:
     *                                api/orangecat/project-link answers "is this OrangeCat project
     *                                being built here" and returns only what /fleet already
     *                                publishes — it withholds an unlisted project exactly as it
     *                                withholds an unknown id, so there is nothing for a signature
     *                                to protect.
     *   api/solon/                 – Solon governance webhooks (decision.finalized); verifies its own HMAC signature
     *   change, commission, api/commission – public website-change intake (/commission redirects to /change); validated,
     *                                rate-limited, write-only studio inbox. Building
     *                                still requires a session at api/projects/from-website.
     *   api/site-consult           – the free consultation on /change: reads ONE public page through
     *                                the SSRF guard (lib/site-consult/fetch-page), judges it by rules
     *                                (no AI), rate-limited per visitor, returns findings only.
     *   take                       – public "Make it yours" intake: pick an open-source project
     *                                and describe your copy. Building requires a session at
     *                                api/projects/from-repo.
     *   api/newsletter             – public email-capture (zod + rate-limited in-handler)
     *   api/reviews/[id]/worker     – expiring, review-scoped bearer ticket; handler checks owner capability
     *   inspection-worker.mjs       – public worker program, contains no credentials
     *   api/feedback               – public widget ingest (fcw_* token auth + CORS); the
     *                                PATCH triage sub-route enforces session auth in-handler
     *   api/widget-boot            – public widget render-gate + heartbeat (same CORS story)
     *   api/widget/transcribe      – widget speech-to-text; fcw_* token auth + origin allowlist
     *                                in-handler, Groq only. Named exactly, NOT `api/widget/`, so
     *                                a future sibling under that prefix is protected by default
     *   api/widget/chat            – widget Chat mode: answers from the public fleet map; same
     *                                fcw_* token + origin allowlist, charged to the token owner's
     *                                fair share of the free AI pool
     *   api/widget/advise          – widget Ask mode: advice on the host page from an outline the
     *                                visitor's browser built; same token, allowlist and budget
     *   api/widget/understand      – Loki reads a spoken note before it is saved (the ask, change
     *                                or question, the asides); same token, allowlist and budget
     *   api/widget/tour            – "Watch the fix" walkthrough script; answers only to a signed
     *                                tour token (lib/feedback/tour-token.ts), CORS like the rest
     *   api/widget/preview         – "Show me" edits for the live page, same tour token (never
     *                                a viewer's), charged to the owner's AI budget
     *   api/widget/owner           – the widget's "This is my site — sign in with Loki": a
     *                                top-level navigation that must reach the handler signed
     *                                OUT so it can send the owner through /sign-in and back
     *                                (the proxy's API 401 was a dead end). The handler itself
     *                                requires a session before it mints anything.
     *   api/chat/review-export     – the nightly fleet chat review reads Loki's day of chats with the
     *                                shared CHAT_REVIEW_TOKEN (bearer, constant-time, 503 when unset);
     *                                api/chat/feedback, its sibling, stays behind the session
     *   api/widget/self-report     – the widget reporting on ITSELF into Loki's own project;
     *                                host fcw_* token + origin allowlist, owner pass for what
     *                                it noticed unasked (lib/widget/self-report.ts)
     *   widget\.js               – the embeddable feedback-widget bundle customer sites load
     *   widget-chat\.js          – its chat chunk (widget/chat/), loaded when the panel opens
     *   import-from-local\.sh      – public bash one-liner users curl-pipe into their terminal
     *                                to scan ~/dev and POST detected repos to /api/projects/import-from-local
     *   fleet, api/fleet/register  – the public fleet register (which projects exist and where);
     *   api/fleet/map              – the public fleet MAP (the register plus purpose, layer, state,
     *                                last movement); bitbaum renders it, Cat reads it, the
     *                                knowledge index embeds it — same public-by-design reason.
     *                                the bitbaum showcase and the footer derive from it, and a
     *                                register behind a session is a register with a private copy
     *                                on every consumer. api/fleet/status stays protected.
     *   api/fleet/private          – unconsented client work for bitbaum's private area; the
     *                                route checks the owner's session itself, so its 401
     *                                carries the CORS headers the studio page needs to read it.
     *   api/studio-session         – who is looking at the studio site: a name, a handle, a
     *                                picture and what they can open. Signed out is an answer
     *                                here, and the proxy's own 401 has no CORS headers, which a
     *                                browser shows as a network failure. Reads the cookie session
     *                                only; GET only; readable by the studio's origin alone.
     *   api/mcp                    – the MCP server AI apps connect to (docs/development/mcp.md).
     *                                It authenticates in-handler (resolveMcpCaller: a ck_* token
     *                                or an OrangeCat JWT minted for this resource), and it MUST
     *                                be reachable without one: a connector's first request has
     *                                no token on purpose, and the 401 + WWW-Authenticate the
     *                                handler returns is how the client discovers OrangeCat. The
     *                                session middleware would answer that with a bare 401 and
     *                                no challenge, and let an OrangeCat JWT through to nowhere.
     *                                A bare prefix like the widget entries: a future api/mcp*
     *                                sibling is public by this line and must guard itself —
     *                                scripts/test/api-route-auth.ts fails any route that does not.
     *   p/                         – prospect previews (docs/architecture/prospect-previews.md):
     *                                a site built for someone with no account, who opens it
     *                                with the studio's access code. The route checks the code
     *                                on every request, pages and files alike
     *                                (src/app/p/[slug]/[[...path]]/route.ts). The trailing slash
     *                                is load-bearing, as for a/ and w/: /pricing, /privacy and
     *                                every other p-word stay behind the session.
     *   \.well-known/oauth-protected-resource
     *                              – RFC 9728 metadata naming OrangeCat as the authorization
     *                                server for api/mcp. It describes how to GET a credential,
     *                                so it cannot require one.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|manifest\\.json|app-icons/|sw\\.js$|opengraph-image|twitter-image|robots\\.txt|sitemap\\.xml|rss\\.xml|sign-in|sign-up|claim-feedback|studio/connect|studio/partner|studio/left(?:/|$)|forgot-password|reset-password|verify-email|setup|invite|download|whitepaper|thoughts|frontier|mission|philosophy|why|how-it-works|no-screen|compare|investors|roadmap|pricing|releases|privacy|terms|license|docs|blog|changelog|support|commission(?:/|$)|change(?:/|$)|take(?:/|$)|build(?:/|$)|u/|share/project/|share/task/|a/|w/|p/|beacon|fleet|import-from-local\\.sh|api/reviews/[^/]+/worker$|inspection-worker\\.mjs$|api/auth|api/agent/install|api/agent/daemon|api/health|api/setup|api/crons|api/system|api/beacon|api/fleet/register|api/fleet/map|api/fleet/private|api/invitations/|api/share/task/|api/orangecat/|api/telegram/webhook$|api/solon/|api/studio-session(?:/|$)|api/studio-intake(?:/|$)|api/studio-partners(?:/|$)|api/studio-recover(?:/|$)|api/studio-portal/|api/commission(?:/|$)|api/site-consult(?:/|$)|api/newsletter|api/feedback|api/widget-boot|api/widget/transcribe|api/widget/chat|api/widget/advise|api/widget/understand|api/widget/tour|api/widget/owner|api/widget/continue|api/widget/preview|api/widget/self-report|api/chat/review-export|api/mcp|\\.well-known/fleet-release\\.json$|\\.well-known/oauth-protected-resource|widget\\.js|widget-chat\\.js).+)",
  ],
};
