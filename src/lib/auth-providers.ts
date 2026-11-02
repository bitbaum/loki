/**
 * SSOT for which auth providers are enabled, derived once from env. Both the
 * NextAuth provider registration (src/auth.ts) and the sign-in page button
 * rendering (src/app/sign-in/page.tsx) consume this, so a sign-in button can
 * never drift from the actually-mounted provider — the bug where prod showed
 * X/GitHub/Google but another env showed a different set because the two places
 * computed "enabled" independently.
 *
 * Server-only: reads non-public env vars. Never import from a client component
 * (the values would be undefined in the client bundle).
 */
import { isDemoEnabled } from "@/config/demo";
import { DEFAULT_AUTH_LABELS, signinBroker } from "@bitbaum/accountkit/auth";
import { isMailConfigured } from "@bitbaum/mail-kit";
import { sharedRuntimeEnabled } from "@bitbaum/accountkit/auth/switch";

export type EnabledAuthProviders = {
  /** GitHub OAuth (NextAuth provider). */
  github: boolean;
  /** Google OAuth (NextAuth provider). */
  google: boolean;
  /** "Sign in with X" via the OAuth 1.0a flow in src/app/api/x-login/*. */
  x: boolean;
  /** "Login with OrangeCat" — OIDC against orangecat.ch (the identity SSOT). */
  orangecat: boolean;
  /**
   * The shared sign-in (SIGNIN_ISSUER/CLIENT_ID/CLIENT_SECRET): one service that
   * holds the Google, Apple, GitHub, X and Facebook credentials for every app.
   * AccountKit mounts it as the OIDC provider `bitbaum-signin` from the same
   * env (signinBroker), so it exists only on the AccountKit runtime.
   */
  signin: boolean;
  /**
   * Passkeys and the second factor: AccountKit's, so on that runtime only.
   * Nothing external is needed for either.
   */
  passkey: boolean;
  /** The sign-in link by email: AccountKit's, and only when account mail can go out. */
  magicLink: boolean;
  /**
   * Whether to SHOW the owner-key (local password) sign-in tab. UI gate only:
   * a configured password AND the explicit opt-in flag. Deliberately NOT the
   * same predicate as the runtime authorize() gate in src/auth.ts, which
   * requires only ENABLE_OWNER_KEY=1 and supports a DB-hash password for
   * packaged installs with no env password. Don't collapse the two.
   */
  localOwnerKeyTab: boolean;
  /**
   * Whether to show the "Explore the demo" button. Same reason the other flags
   * live here: the button must never appear on an instance where the demo user
   * was never seeded, which is a server-side fact the client cannot read.
   */
  demo: boolean;
};

/**
 * Providers whose keys are set but whose sign-in is broken at the provider, so
 * they are neither shown nor mounted: a button that cannot sign anyone in is
 * worse than no button (fleet rule: never advertise an unconfigured provider).
 * Delete a line once that provider's console is fixed and a sign-in through it
 * has been tried on the live site.
 */
export const PAUSED_PROVIDERS: Partial<Record<"github" | "google" | "x", string>> = {
  google:
    "2026-10-30: Google rejects the sign-in with redirect_uri_mismatch. Add https://loki.orangecat.ch/api/auth/callback/google to the OAuth client's authorised redirect URIs in Google Cloud.",
  x: "2026-10-30: /api/x-login/start fails before reaching X (sign-in?error=XLoginStart). Check the X app's 1.0a keys and callback URL in the X developer portal.",
};

export function getEnabledAuthProviders(): EnabledAuthProviders {
  // On AccountKit (AUTH_RUNTIME=accountkit) GitHub signs in through Loki's own
  // GitHub app, as on Auth.js. Google and X are not mounted there (AccountKit
  // reaches them only through the bitbaum sign-in), and the owner key accepts
  // only a stored hash (docs/architecture/accountkit-migration.md).
  const shared = sharedRuntimeEnabled();
  return {
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    google:
      !shared &&
      !PAUSED_PROVIDERS.google &&
      Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    // X's OAuth 2.0 authorize endpoint 503s on this Pay-Per-Use account, so the
    // 1.0a consumer keys are the gate — not the 2.0 client id/secret.
    x:
      !shared &&
      !PAUSED_PROVIDERS.x &&
      Boolean(process.env.X1_CONSUMER_KEY && process.env.X1_CONSUMER_SECRET),
    orangecat: Boolean(
      process.env.ORANGECAT_OAUTH_CLIENT_ID && process.env.ORANGECAT_OAUTH_CLIENT_SECRET,
    ),
    signin: shared && signinBroker(process.env) !== null,
    passkey: shared,
    magicLink: shared && isMailConfigured(process.env),
    localOwnerKeyTab:
      !shared && Boolean(process.env.LOCAL_AUTH_PASSWORD) && process.env.ENABLE_OWNER_KEY === "1",
    demo: isDemoEnabled(),
  };
}

/**
 * The shared sign-in button's words, AccountKit's own ("Continue with Google,
 * Apple, GitHub, X or Facebook"), or null when it is off. Computed here so the
 * client bundle never imports the server half of AccountKit.
 */
export function sharedSigninLabel(enabled: Pick<EnabledAuthProviders, "signin">): string | null {
  return enabled.signin ? DEFAULT_AUTH_LABELS.withSignin : null;
}
