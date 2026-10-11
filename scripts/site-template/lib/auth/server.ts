import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth, magicLink, twoFactor } from "better-auth/plugins";
import type { GenericOAuthConfig } from "better-auth/plugins";
import { getDb, isDatabaseConfigured, schema } from "@/lib/db/client";
import { mailConfigured, sendAuthMail } from "@/lib/mail";
import { SITE } from "@/lib/site";
import { DEFAULT_ROLE } from "./roles";
import { oidcClients, placeholderEmail, signInMethods, type OidcClient } from "./methods";

/**
 * Accounts — better-auth 1.x on Drizzle + pg (fleet STACK.md, "Identity",
 * 2026-10-11). This app owns its accounts and offers every method; see
 * lib/auth/methods.ts for which are shown when.
 *
 * Built on first request, never at import: `next build` evaluates route
 * modules, and an instance built there would make the build need a database
 * and a secret. A running server without them answers "accounts unavailable"
 * on every auth surface instead of crashing (see `authStatus`).
 */
const MIN_SECRET_LENGTH = 32;
const DEV_SECRET = "development-only-secret-never-used-in-production-0000";

export type AuthStatus = { ready: true } | { ready: false; reason: "no_database" | "no_secret" };

export function authStatus(env: NodeJS.ProcessEnv = process.env): AuthStatus {
  if (!isDatabaseConfigured(env)) return { ready: false, reason: "no_database" };
  const secret = env.BETTER_AUTH_SECRET?.trim() ?? "";
  if (env.NODE_ENV === "production" && secret.length < MIN_SECRET_LENGTH) {
    return { ready: false, reason: "no_secret" };
  }
  return { ready: true };
}

function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim() ?? "";
  if (secret.length >= MIN_SECRET_LENGTH) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is missing or shorter than 32 characters");
  }
  return DEV_SECRET;
}

/** An OIDC client as better-auth's generic OAuth provider. */
export function oidcProvider(client: OidcClient): GenericOAuthConfig {
  return {
    providerId: client.providerId,
    discoveryUrl: client.discoveryUrl,
    // Identity comes from a VERIFIED id_token (issuer + JWKS from discovery);
    // a discovery that cannot provide them skips the provider instead of
    // silently decoding an unverified token.
    requireIdTokenVerification: true,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    // OrangeCat's token endpoint accepts ONLY client_secret_post (it answers
    // basic with a misleading 400 "client_id is required"); the broker speaks
    // the same. PKCE is required even for confidential clients.
    tokenEndpointAuth: { method: "client_secret_post" },
    pkce: true,
    scopes: ["openid", "profile", "email"],
    // Who signed in, never their provider address: see placeholderEmail.
    mapProfileToUser: (profile) => {
      const subject = String(profile.sub ?? profile.id ?? "");
      if (!subject) throw new Error(`${client.providerId}: id_token has no sub`);
      const handle =
        typeof profile.preferred_username === "string" ? profile.preferred_username : "";
      return {
        name: handle.replace(/^@/, "").slice(0, 80),
        email: placeholderEmail(client.providerId, subject),
        emailVerified: false,
        image: undefined,
      };
    },
  };
}

function createAuth() {
  const mail = mailConfigured();
  const methods = signInMethods(process.env, mail);
  const providers = oidcClients(process.env).map(oidcProvider);
  const origin = new URL(SITE.url);

  return betterAuth({
    appName: SITE.title,
    secret: authSecret(),
    // Pinned, never inferred from the request: behind Caddy the app sees its
    // INTERNAL origin, and links built from it point at localhost (fleet
    // nextauth-origin-audit.mjs, petvity).
    baseURL: SITE.url,
    trustedOrigins: [origin.origin],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        passkey: schema.passkey,
        twoFactor: schema.twoFactor,
      },
    }),
    telemetry: { enabled: false },
    // One rate limiter, keyed on the proxy's hop: limitkit, in the route
    // handler (app/api/auth/[...all]/route.ts). better-auth's own would key on
    // the first X-Forwarded-For entry, which the caller chooses.
    rateLimit: { enabled: false },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      // An IP address next to a session is personal data the product does not
      // need. Not stored.
      ipAddress: { disableIpTracking: true },
      cookiePrefix: SITE.slug,
    },
    session: {
      expiresIn: 14 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      // Changing a password, a passkey or 2FA needs a session younger than this.
      freshAge: 15 * 60,
    },
    user: {
      additionalFields: {
        // Never accepted from the person: a sign-up body carrying
        // role: "admin" is ignored. See lib/auth/roles.ts.
        role: { type: "string", required: false, defaultValue: DEFAULT_ROLE, input: false },
      },
      deleteUser: { enabled: true },
      changeEmail: { enabled: mail },
    },
    account: {
      accountLinking: {
        enabled: true,
        // An address is never an identity: a new sign-in method joins an
        // account only when the signed-in person links it from /account.
        disableImplicitLinking: true,
        allowDifferentEmails: true,
      },
      encryptOAuthTokens: true,
    },
    databaseHooks: {
      account: {
        // This app needs to know WHO signed in, not to act at the provider on
        // their behalf, so provider tokens are dropped before they are stored.
        create: {
          before: async (data) => ({
            data: { ...data, accessToken: null, refreshToken: null, idToken: null },
          }),
        },
        update: {
          before: async (data) => ({
            data: { ...data, accessToken: null, refreshToken: null, idToken: null },
          }),
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: !methods.verifyEmail,
      // Without mail a verification link could never arrive, and requiring
      // one would strand every new account.
      requireEmailVerification: methods.verifyEmail,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => sendAuthMail("reset", user.email, url),
    },
    emailVerification: {
      sendOnSignUp: methods.verifyEmail,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => sendAuthMail("verify", user.email, url),
    },
    plugins: [
      // allowPasswordless: someone who signs in only by passkey, link or OIDC can
      // still add a second factor (with a fresh session instead of a password).
      twoFactor({ issuer: SITE.title, allowPasswordless: true }),
      passkey({ rpID: origin.hostname, rpName: SITE.title, origin: origin.origin }),
      ...(methods.magicLink
        ? [
            magicLink({
              expiresIn: 10 * 60,
              sendMagicLink: async ({ email, url }) => sendAuthMail("magicLink", email, url),
            }),
          ]
        : []),
      ...(providers.length > 0 ? [genericOAuth({ config: providers })] : []),
      // Lets server actions set cookies; keep it last.
      nextCookies(),
    ],
  });
}

let instance: ReturnType<typeof createAuth> | null = null;

/** The auth instance. Call only after `authStatus().ready`. */
export function getAuth() {
  if (!instance) instance = createAuth();
  return instance;
}

export type Auth = ReturnType<typeof getAuth>;
