import type { NavLink } from "@/components/public/PublicSurface";

// Single source of truth for all auth and app route strings.
// Import from here — never hardcode "/sign-in" or "/today" in components.
export const ROUTES = {
  // Public app
  HOME: "/",
  // Auth
  SIGN_IN: "/sign-in",
  SIGN_UP: "/sign-up",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",
  VERIFY_EMAIL: "/verify-email",
  ONBOARDING: "/onboarding",
  SIGN_OUT: "/sign-out",
  // Post-auth default
  APP_HOME: "/today",
  // Where the Fleet Runner desktop shell lands a signed-in operator. The
  // runner opens at OS startup and points at APP_URL (no path), so without
  // this it drops the owner on the marketing hero every morning — a pitch
  // page, not a command deck. Control is the surface that answers "what do I
  // do now": live agent state, per-project Launch agent, and Build selected
  // across many projects at once.
  RUNNER_HOME: "/control",
} as const;

/** Query flag that lets a Fleet Runner operator open the public marketing
 *  homepage on purpose (reviewing their own hero) instead of being bounced to
 *  RUNNER_HOME. Without it the landing page is unreachable inside the app. */
export const SITE_PREVIEW_PARAM = "site";

/** Headings for every auth surface — pages import these, they do not invent copy. */
export const AUTH_COPY = {
  signIn: {
    title: "Welcome back",
    description: (appName: string) => `Sign in to your ${appName} account.`,
  },
  signUp: {
    title: "Create your account",
    description: "Free to start. Add projects, launch agents, track everything.",
  },
  forgot: {
    title: "Reset your password",
    description: "Enter your email and we'll send a reset link.",
    sentTitle: "Check your email",
    sentDescription: (email: string) =>
      `If an account exists for ${email}, we've sent a reset link. Check your inbox (and spam folder).`,
  },
  reset: {
    title: "Choose a new password",
    description: "Use at least 8 characters.",
    doneTitle: "Password updated",
    doneDescription: "Your password has been reset. Redirecting to sign in…",
  },
  verify: {
    title: "Check your inbox",
    description: "We sent you a verification link. Click it to confirm your email.",
    successTitle: "Email verified",
    successDescription: "Your email address has been confirmed. You're all set.",
    expiredTitle: "Link expired",
    expiredDescription:
      "This verification link is invalid or has expired. Enter your email to get a new one.",
  },
} as const;

// ─── Public marketing nav — platform-wide content only.
//
// A deliberate architectural boundary lives here: every entry must apply to
// the whole platform, not to a single user. Per-user surfaces (the user's
// own Thoughts, profile, etc.) live in the in-app sidebar and on user
// profile routes (/u/<username>/...), never in the public marketing nav —
// even when the founder's own essays happen to discuss the platform.
//
// Three shapes:
//   - "menu" → dropdown with items + descriptions (mega-menu)
//   - "link" → single direct link in the top nav
//   - "external" → link to another origin (sibling product, etc.)
//                  Rendered with an explicit external-target indicator so
//                  visitors know they are leaving loki.orangecat.ch.
// The shape is per-entry so we never paint a one-item dropdown.

export type PublicNavItem = NavLink & { description: string };
export type PublicNavSection = { title: string; items: PublicNavItem[] };
export type PublicNavEntry =
  | { kind: "menu"; label: string; sections: PublicNavSection[] }
  | { kind: "link"; label: string; href: string }
  | { kind: "external"; label: string; href: string; description?: string };

export const PUBLIC_NAV: PublicNavEntry[] = [
  {
    kind: "menu",
    label: "Product",
    // Rebuilt 2026-10-01. "Start" answers "what is this and how do I begin",
    // "Learn" holds the depth. Frontier left (its producer was removed
    // 2026-09-25 and the page had frozen); Mission and Philosophy merged into
    // /why, which said the same three things twice and contradicted itself.
    sections: [
      {
        title: "Start",
        items: [
          {
            label: "How it works",
            href: "/how-it-works",
            description: "From a sentence to a working site — and under the hood",
          },
          {
            label: "Compare",
            href: "/compare",
            description: "Loki next to Claude Code, Codex, Lovable and others",
          },
          {
            label: "Change a website",
            href: "/commission",
            description: "Start with its address and the changes you want",
          },
          { label: "Pricing", href: "/pricing", description: "Free while Loki is in beta" },
          {
            label: "Download",
            href: "/download",
            description: "Fleet Runner for Linux, Windows and Apple-silicon Macs",
          },
        ],
      },
      {
        title: "Learn",
        items: [
          {
            label: "Why Loki",
            href: "/why",
            description: "What it is for, and the rules it keeps",
          },
          {
            label: "Docs",
            href: "/docs",
            description: "Set up, connect agents, add the feedback button",
          },
          {
            label: "Built with Loki",
            href: "/fleet",
            description: "Projects whose owners chose to show them",
          },
          { label: "Roadmap", href: "/roadmap", description: "What works now and what comes next" },
          { label: "Changelog", href: "/changelog", description: "What changed, dated" },
          {
            label: "Whitepaper",
            href: "/whitepaper",
            description: "The full technical design",
          },
        ],
      },
    ],
  },
  {
    // Label matches the destination page's own title ("Thoughts") — the old
    // "Blog" label landed on a page that never calls itself a blog. /blog now
    // redirects here so the canonical URL is the one the nav shows.
    kind: "link",
    label: "Thoughts",
    href: "/thoughts",
  },
  {
    kind: "link",
    label: "Support",
    href: "/support",
  },
  // Dropdown descriptions stay to one short sentence — the essay-length
  // context lives in the Thoughts essays, not in a hover.
  {
    kind: "external",
    label: "OrangeCat",
    href: "https://orangecat.ch",
    description: "The economic pillar of the stack — Bitcoin-native funding and public entities.",
  },
  {
    kind: "external",
    label: "Solon",
    href: "https://solon.orangecat.ch",
    description: "The governance pillar of the stack — Bitcoin-signed proposals and votes.",
  },
  {
    // Since #995 paid, done-for-you work belongs to the studio, and nothing in
    // Loki's nav reached its door.
    kind: "external",
    label: "bitbaum",
    href: "https://bitbaum.orangecat.ch/hire/",
    description: "The studio — have it built for you.",
  },
];
