import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

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
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    /*
     * Run on every path EXCEPT:
     *   _next/static, _next/image  – Next.js internals
     *   favicon.ico                – browser icon request
     *   icon\.svg, manifest\.json  – PWA / browser-tab static assets
     *   opengraph-image, twitter-image – social card crawlers (FB, Twitter, Slack, LinkedIn)
     *   robots\.txt, sitemap\.xml  – search engines
     *   rss\.xml                   – public Thoughts feed (readers fetch unauthenticated)
     *   /                          – public landing page (.+ not .*)
     *   sign-in, sign-up, claim-feedback – public auth and feedback-claim pages
     *   forgot-password, reset-password, verify-email, setup, invite
     *   download                    – public install/discovery page
     *   whitepaper, thoughts       – public content
     *   docs, blog, changelog,     – public marketing surface (docs subsumes docs/quickstart)
     *   support
     *   frontier                   – daily AI/robotics frontier digest (public)
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
     *   api/orangecat/             – OrangeCat webhooks (entitlement, events, site, actor-status); each verifies its own HMAC
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
     *   api/widget/tour            – "Watch the fix" walkthrough script; answers only to a signed
     *                                tour token (lib/feedback/tour-token.ts), CORS like the rest
     *   api/widget/preview         – "Show me" edits for the live page, same tour token (never
     *                                a viewer's), charged to the owner's AI budget
     *   widget\.js                – the embeddable feedback-widget bundle customer sites load
     *   import-from-local\.sh      – public bash one-liner users curl-pipe into their terminal
     *                                to scan ~/dev and POST detected repos to /api/projects/import-from-local
     *   fleet, api/fleet/register  – the public fleet register (which projects exist and where);
     *   api/fleet/map              – the public fleet MAP (the register plus purpose, layer, state,
     *                                last movement); bitbaum renders it, Cat reads it, the
     *                                knowledge index embeds it — same public-by-design reason.
     *                                the bitbaum showcase and the footer derive from it, and a
     *                                register behind a session is a register with a private copy
     *                                on every consumer. api/fleet/status stays protected.
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
     *   \.well-known/oauth-protected-resource
     *                              – RFC 9728 metadata naming OrangeCat as the authorization
     *                                server for api/mcp. It describes how to GET a credential,
     *                                so it cannot require one.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|manifest\\.json|opengraph-image|twitter-image|robots\\.txt|sitemap\\.xml|rss\\.xml|sign-in|sign-up|claim-feedback|forgot-password|reset-password|verify-email|setup|invite|download|whitepaper|thoughts|frontier|mission|philosophy|why|how-it-works|compare|investors|roadmap|pricing|releases|privacy|terms|license|docs|blog|changelog|support|commission(?:/|$)|change(?:/|$)|take(?:/|$)|u/|share/project/|share/task/|a/|w/|beacon|fleet|import-from-local\\.sh|api/auth|api/agent/install|api/agent/daemon|api/health|api/setup|api/crons|api/system|api/beacon|api/fleet/register|api/fleet/map|api/invitations/|api/share/task/|api/orangecat/|api/solon/|api/studio-intake(?:/|$)|api/studio-partners(?:/|$)|api/studio-recover(?:/|$)|api/studio-portal/|api/commission(?:/|$)|api/site-consult(?:/|$)|api/newsletter|api/feedback|api/widget-boot|api/widget/transcribe|api/widget/chat|api/widget/advise|api/widget/tour|api/widget/preview|api/mcp|\\.well-known/oauth-protected-resource|widget\\.js).+)",
  ],
};
