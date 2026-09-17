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
     *   api/orangecat/             – OrangeCat webhooks (entitlement, events); each verifies its own HMAC signature
     *   api/solon/                 – Solon governance webhooks (decision.finalized); verifies its own HMAC signature
     *   api/newsletter             – public email-capture (zod + rate-limited in-handler)
     *   api/feedback               – public widget ingest (fcw_* token auth + CORS); the
     *                                PATCH triage sub-route enforces session auth in-handler
     *   api/widget-boot            – public widget render-gate + heartbeat (same CORS story)
     *   api/widget/transcribe      – widget speech-to-text; fcw_* token auth + origin allowlist
     *                                in-handler, Groq only. Named exactly, NOT `api/widget/`, so
     *                                a future sibling under that prefix is protected by default
     *   widget\.js                 – the embeddable feedback-widget bundle customer sites load
     *   import-from-local\.sh      – public bash one-liner users curl-pipe into their terminal
     *                                to scan ~/dev and POST detected repos to /api/projects/import-from-local
     *   fleet, api/fleet/register  – the public fleet register (which projects exist and where);
     *   api/fleet/map              – the public fleet MAP (the register plus purpose, layer, state,
     *                                last movement); bitbaum renders it, Cat reads it, the
     *                                knowledge index embeds it — same public-by-design reason.
     *                                the bitbaum showcase and the footer derive from it, and a
     *                                register behind a session is a register with a private copy
     *                                on every consumer. api/fleet/status stays protected.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|manifest\\.json|opengraph-image|twitter-image|robots\\.txt|sitemap\\.xml|rss\\.xml|sign-in|sign-up|claim-feedback|forgot-password|reset-password|verify-email|setup|invite|download|whitepaper|thoughts|frontier|mission|philosophy|investors|roadmap|pricing|releases|privacy|terms|license|docs|blog|changelog|support|u/|share/project/|share/task/|a/|beacon|fleet|import-from-local\\.sh|api/auth|api/agent/install|api/agent/daemon|api/health|api/setup|api/crons|api/system|api/beacon|api/fleet/register|api/fleet/map|api/invitations/|api/share/task/|api/orangecat/|api/solon/|api/newsletter|api/feedback|api/widget-boot|api/widget/transcribe|widget\\.js).+)",
  ],
};
