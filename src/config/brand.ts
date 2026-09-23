// Single source of truth for the product brand on the TypeScript side.
// scripts/_brand.sh mirrors APP_NAME / APP_SLUG / APP_DOMAIN for shell.
// To rebrand the entire product, edit this file + scripts/_brand.sh + the
// Caddy host config on the box + DNS at the registrar — that's it.
//
// Conventions:
//   APP_NAME     Display string. Appears in <title>, sidebar, marketing.
//   APP_SLUG     Lowercase kebab. Used in URLs, file paths, env-var prefixes.
//   APP_DOMAIN   Canonical hostname (no scheme). Used in callbacks, emails, copy.
//
// Visual identity: The primary mark is the spiral SVG defined in
// BrandMark.tsx (alternating semicircular arcs of growing radius, two-layer
// fade). icon.svg + all opengraph-*.tsx MUST stay pixel-identical (see
// comments in those files). Never introduce a second mark. Public surfaces
// always dark; ui-public-* / ui-auth-* intentionally use white/opacity inside
// globals.css only.
//
// Name evaluation criteria (from first principles + product positioning):
// - Must preserve "fleet" language in copy (run your fleet, fleet scale,
//   fleet command, Fleet Runner, robotic fleets, orchestration).
// - Must evoke active human command / control plane / direction / judgment
//   (not passive ride/surf, not just "the tool for X").
// - Tone: serious infrastructure for power users & future robotics, not toy or
//   meme. "Serious operators", "no compromises", "durable OS".
// - Scalable to non-AI (robots, physical fleets) without sounding silly.
// - Ownable: clean .com/.app, socials, no major TM conflicts (esp. avoid Disney
//   "Muppet", heavy existing industrial "Crown fleet", etc.).
// - Short, memorable slug; works as wordmark + icon; easy to say/spell.
// - Supports shared cloud execution plus optional local Fleet Runner, all
//   steered through one remote control plane.
// See docs/branding-design.md for the full rationale, name selection criteria,
// visual identity rules, and why Loki was selected/stuck with over
// alternatives (including recent .com-available "shade/shady fleet" proposals
// like shadefleet.com / shadyfleet.com, and especially fleetclown.com — the
// latter rejected as the worst possible inversion of "crown"/command/serious
// infrastructure tone).

export const APP_NAME = "Loki";
export const APP_SLUG = "loki";
export const APP_DOMAIN = "loki.orangecat.ch";
export const APP_KICKER = "Personal Systems";
export const APP_DESCRIPTION =
  "Command your agents, projects, and personal systems from one workspace.";

// Helpers — never hardcode these patterns in components.
export const APP_URL = `https://${APP_DOMAIN}`;
// Dev fallback when NEXTAUTH_URL is unset (local dev server).
export const LOCAL_DEV_URL = "http://localhost:3000";

// Bridge — the Hetzner SSE fan-out service that delivers fc:state events to
// every connected browser, desktop, and phone. Hosted on the shared bitbaum
// box at bridge.orangecat.ch (shared between Loki + OrangeCat, see
// memory:decision_hetzner_consolidation). Always HTTPS, always /sse path.
//
// Override per-runtime:
//   - Web (Next.js):    NEXT_PUBLIC_LOKI_BRIDGE_URL
//   - Desktop (Node):   LOKI_BRIDGE_URL
// Override use cases: pointing a dev instance at a local bridge (http://localhost:4001/sse)
// during testing. Production never overrides — the constant below is the truth.
export const BRIDGE_DOMAIN = "bridge.orangecat.ch";
export const BRIDGE_URL = `https://${BRIDGE_DOMAIN}/sse`;

// Email "From" is no longer defined here: the sender SSOT is the RESEND_FROM
// env var (read by @bitbaum/mail-kit), with mail-kit's fleet-conventional
// sender as the fallback — see src/lib/email.ts.
/** Short lowercase tagline for OG images, profile footers, and email chrome —
 *  the compact sibling of MARKETING_TAGLINE below. Was "your life operating
 *  system", which survived the life-OS → agent-fleet pivot and kept shipping
 *  the old product's promise on every public profile and social card. */
export const APP_TAGLINE = "run your agent fleet";

// Marketing / Positioning (SSOT for public copy)
export const MARKETING_TAGLINE = "The operating system for people running real AI agents.";
export const MARKETING_HERO_PRIMARY = "Run your fleet.";
export const MARKETING_HERO_SECONDARY = "From anywhere.";
export const MARKETING_POSITIONING = "Cloud + local builders · One control plane";
/** Phone-width variant of the positioning badge. The full string needs ~330px
 *  of tracked uppercase and wrapped to two lines inside a pill on every phone,
 *  where a badge that wraps stops reading as a badge. Same claim, two terms. */
export const MARKETING_POSITIONING_SHORT = "Cloud + local · One control plane";
