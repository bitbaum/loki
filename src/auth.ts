import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { ROUTES } from "@/config/auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { sql } from "drizzle-orm";
// db required here for DrizzleAdapter — not avoidable
import { db } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";
import { verifyPassword } from "@/lib/password";
import {
  getDefaultUser,
  getUserById,
  getUserByEmail,
  updateUser,
  setUserOrangeCatActorId,
  type UpdateUserInput,
} from "@/db/queries/users";
import { getOrgMembershipCount, createPersonalOrg } from "@/db/queries/orgs";
import { logDebug } from "@/db/queries/debug-logs";
import { healReturningUserOnboarding, onboardingCompleteFlag } from "@/lib/onboarding-heal";
import { isValidUuid } from "@/lib/utils";
import { verifyTicket } from "@/lib/x-oauth1";
import { findOrCreateTwitterUser } from "@/db/queries/oauth-x";
import { getEnabledAuthProviders } from "@/lib/auth-providers";
import { ORANGECAT_BASE_FALLBACK } from "@/lib/integrations/orangecat";
import { persistOAuthTokens, type OAuthTokenSet } from "@/lib/auth/persist-oauth-tokens";

// Enabled-provider predicates, shared with the sign-in page (src/app/sign-in)
// so a rendered button can never drift from the mounted provider.
const enabledProviders = getEnabledAuthProviders();

/**
 * Auth.js wraps every authorize()→null return in a generic CredentialsSignin
 * error whose message is just "Read more at https://errors.authjs.dev/...",
 * which makes debug_logs forensics worthless when a user can't sign in.
 * This helper records the actual failure reason (provider + reason + identifier
 * minus password) BEFORE returning null, so the operator can tell apart
 * brute-force vs forgotten-password vs missing-account at a glance.
 */
function logAuthReject(
  provider: "local" | "email-password" | "user-password" | "x-1a",
  reason: "missing-input" | "user-not-found" | "no-password-hash" | "wrong-password",
  identifier?: string | null,
): null {
  logDebug({
    source: "auth.authorize",
    level: "warn",
    message: `credentials rejected: ${provider} / ${reason}`,
    meta: { provider, reason, identifier: identifier ?? null },
  });
  return null;
}

/**
 * Companion to logAuthReject — records the matching success event so that
 * a 5-reject / 1-accept burst reads as "forgotten password recovered" and
 * a 5-reject / 0-accept burst reads as "locked out OR attacker bailed".
 * Without this, reject events float alone and the pair correlation is lost.
 */
function logAuthAccept(
  provider: "local" | "email-password" | "user-password" | "x-1a",
  identifier: string | null | undefined,
  userId: string,
): void {
  logDebug({
    source: "auth.authorize",
    level: "info",
    message: `credentials accepted: ${provider}`,
    meta: { provider, identifier: identifier ?? null, userId },
  });
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
      username: string | null;
      onboardedAt: Date | null;
      onboardingComplete?: boolean;
      emailVerified?: Date | null;
      /**
       * Set in the session callback from the JWT's own email claim rather than
       * read off session.user.email at the call site — the demo gate in
       * authorized() must not depend on NextAuth's internal population order,
       * because a gate whose subject is silently undefined enforces nothing.
       */
      isDemo?: boolean;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    onboardingComplete?: boolean;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // Persist Auth.js error events to the database — the host's runtime logs
  // aren't reliably reachable from this environment, and an auth failure that
  // can't be diagnosed is functionally a P0. Low write volume in steady state
  // (only fires on actual errors).
  logger: {
    error: (err) => {
      console.error("[auth.logger.error]", err?.name, err?.message, err);
      // Suppress the redundant catch-all row for CredentialsSignin — the
      // authorize() helpers already wrote a structured warn row with
      // provider/reason/identifier via logAuthReject; this row would only
      // add the useless "Read more at https://errors.authjs.dev/..."
      // message we replaced. Other error types (MissingCSRF, AccessDenied,
      // OAuthCallbackError, system errors) still flow through — they have
      // no dedicated logger and this is their only debug_logs surface.
      // Halves the row count on credentials brute-force bursts; verified
      // live by triggering a credentials reject and observing only the
      // auth.authorize row land.
      if ((err as { type?: string })?.type === "CredentialsSignin") return;
      const unwrapCause = (c: unknown, depth = 0): unknown => {
        if (!c || depth > 4) return c;
        if (c instanceof Error) {
          return {
            name: c.name,
            message: c.message,
            stack: c.stack?.split("\n").slice(0, 6).join("\n"),
            cause: unwrapCause((c as { cause?: unknown }).cause, depth + 1),
          };
        }
        if (typeof c === "object") {
          try {
            return JSON.parse(
              JSON.stringify(c, (_, v) =>
                v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
              ),
            );
          } catch {
            // JSON.stringify can throw on circular references (Auth.js internal
            // errors carry context refs that loop), BigInt values, etc. The old
            // fallback was `String(c)` which gave a useless "[object Object]"
            // and erased every signal — verified live in a 2026-05-19 accessdenied
            // entry whose only diagnostic was that literal string. Extract a
            // best-effort shape: constructor name plus the string/number/boolean
            // own-properties, plus any nested Error message.
            try {
              const o = c as Record<string, unknown>;
              const shape: Record<string, unknown> = {
                __ctor: (o?.constructor as { name?: string })?.name ?? "Object",
              };
              for (const k of Object.keys(o)) {
                const v = o[k];
                if (v instanceof Error) shape[k] = { name: v.name, message: v.message };
                else if (
                  typeof v === "string" ||
                  typeof v === "number" ||
                  typeof v === "boolean" ||
                  v === null
                )
                  shape[k] = v;
              }
              return shape;
            } catch {
              return String(c);
            }
          }
        }
        return c;
      };
      const meta: Record<string, unknown> = {
        name: err?.name,
        type: (err as { type?: string })?.type,
        stack: err?.stack?.split("\n").slice(0, 8).join("\n"),
      };
      if (err?.cause) meta.cause = unwrapCause(err.cause);
      db.execute(
        sql`
        INSERT INTO debug_logs (source, level, message, meta)
        VALUES ('auth', 'error', ${err?.message ?? String(err)}, ${JSON.stringify(meta)}::jsonb)
      `,
      ).catch(() => {});
    },
  },
  events: {
    async signIn(message) {
      // Org bootstrap moved here from the signIn callback — at this point
      // `user.id` is the DB UUID (handleLoginOrRegister has run), so org
      // queries that join on uuid columns are safe.
      try {
        if (message.user?.id) {
          const existing = await getUserById(message.user.id);
          if (existing) {
            await healReturningUserOnboarding(existing);
          }

          // Cross-product identity bridge: on an OrangeCat OIDC sign-in the
          // providerAccountId IS the OrangeCat actor_id (id_token.sub). Persist
          // it so the rest of the app can resolve "this FC user = that OC actor"
          // without joining through the accounts table. Idempotent — same value
          // every sign-in.
          const account = (
            message as { account?: { provider?: string; providerAccountId?: string } }
          ).account;

          // Store what this sign-in just handed us. The adapter writes tokens
          // only on the FIRST link, so without this a re-authorization — the
          // remedy every broken-link message points at — signs the person in
          // and changes nothing. Measured: five fresh OrangeCat token sets
          // issued in one day, all discarded, while the stored link stayed
          // dead. See lib/auth/persist-oauth-tokens.ts.
          await persistOAuthTokens(account as OAuthTokenSet, message.user.id);

          if (
            account?.provider === "orangecat" &&
            account.providerAccountId &&
            isValidUuid(account.providerAccountId) &&
            existing?.orangecatActorId !== account.providerAccountId
          ) {
            await setUserOrangeCatActorId(message.user.id, account.providerAccountId);
          }

          const memberCount = await getOrgMembershipCount(message.user.id);
          if (memberCount === 0) {
            const displayName = message.user.name ?? message.user.email?.split("@")[0] ?? "user";
            await createPersonalOrg(message.user.id, displayName);
          }
        }
      } catch (e) {
        // Org bootstrap failures must not block sign-in. They'll surface in
        // debug_logs but the user still lands authenticated.
        db.execute(
          sql`
          INSERT INTO debug_logs (source, level, message, meta)
          VALUES ('auth', 'event:signIn-org-bootstrap', ${(e as Error)?.message ?? String(e)},
                  ${JSON.stringify({ userId: message.user?.id, name: (e as Error)?.name })}::jsonb)
        `,
        ).catch(() => {});
      }
    },
  },
  // Allow localhost and any host when AUTH_TRUST_HOST=true. Caddy terminates
  // TLS in front of the app on the box, where scripts/hetzner/gen-env.sh writes
  // this var. EVERY other entry point has to set it too: unset, Auth.js answers
  // /api/auth/session with 500 UntrustedHost and no page can read a session.
  // This comment used to claim the local production server set it — it did not,
  // and neither did .env.example or docker-compose.yml, so a clean checkout
  // came up broken on the documented path. Compared as the exact string
  // "true", so "1" is not a truthy value here.
  trustHost: process.env.AUTH_TRUST_HOST === "true",
  // JWT strategy required for Credentials provider to work alongside DB adapter
  session: { strategy: "jwt" },
  providers: [
    // "Login with OrangeCat" — OIDC against the OrangeCat authorization server
    // (the identity SSOT; see docs/architecture/cross-product-identity-bridge.md
    // Part A). Endpoints are discovered from the issuer's
    // /.well-known/openid-configuration; id_token.sub is the user's OrangeCat
    // actor_id, persisted to users.orangecatActorId in events.signIn below.
    // Requesting the capability scopes here is the "one consent" grant: the
    // adapter stores the access token on the accounts row, which later powers
    // project publish + timeline promote without a separate API-key step.
    ...(enabledProviders.orangecat
      ? [
          {
            id: "orangecat",
            name: "OrangeCat",
            type: "oidc" as const,
            issuer: process.env.ORANGECAT_OAUTH_ISSUER ?? ORANGECAT_BASE_FALLBACK,
            clientId: process.env.ORANGECAT_OAUTH_CLIENT_ID!,
            clientSecret: process.env.ORANGECAT_OAUTH_CLIENT_SECRET!,
            // OrangeCat's token endpoint only supports client_secret_post (creds in
            // the form body); Auth.js defaults to client_secret_basic, which OC
            // rejects with 400 "client_id is required" at the code-exchange step.
            client: { token_endpoint_auth_method: "client_secret_post" as const },
            checks: ["pkce" as const, "state" as const],
            authorization: {
              params: {
                scope: "openid profile email project.read project.write timeline.write wallet.read",
              },
            },
            // Actor `sub`, not email, is the cross-product identity boundary.
            // Do not silently attach an OrangeCat actor to an existing Loki
            // account merely because the email strings happen to match.
          },
        ]
      : []),
    // Conditionally mounted (like Google/X) so a missing key pair cleanly
    // drops the provider instead of mounting it with empty-string creds that
    // fail opaquely on use. env.ts also flags a half-set pair loudly at boot.
    ...(enabledProviders.github
      ? [
          GitHub({
            clientId: process.env.GITHUB_CLIENT_ID!,
            clientSecret: process.env.GITHUB_CLIENT_SECRET!,
            allowDangerousEmailAccountLinking: true,
            // Scopes:
            //   read:user + user:email — sign-in identity (Auth.js defaults)
            //   repo                   — create + read + write private and public
            //                            repos. Required by /api/projects/create-
            //                            with-github (the "Start a new project"
            //                            flow on /control) and by /api/github/repos
            //                            for listing repos including private ones.
            // Without `repo`, GitHub returns 404 from POST /user/repos rather than
            // a clear 403 (security-through-obscurity on their side). Surfaced
            // during dogfood 2026-06-05 as "GitHub API rejected the create (404)".
            // Existing tokens minted before this change won't pick up the new
            // scope automatically — users must sign out + sign back in to re-mint.
            // `workflow`: without it GitHub refuses to create or update
            // .github/workflows/* with this token, so kickoff could seed a
            // starter but never its deploy shim — every fresh site sat with
            // no CD until someone pushed the file by hand (velokiosk-sep10,
            // 2026-09-10). Existing sessions keep the old grant until they
            // sign in with GitHub again.
            authorization: { params: { scope: "read:user user:email repo workflow" } },
          }),
        ]
      : []),
    ...(enabledProviders.google
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    // X / Twitter login uses OAuth 1.0a (see the "x-1a" Credentials provider
    // below + src/app/api/x-login/*). The OAuth 2.0 Twitter provider was
    // removed because X's /i/oauth2/authorize 503s for Pay-Per-Use accounts.
    Credentials({
      id: "local",
      name: "Local access",
      credentials: {
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // Structural gate matching the UI tab in src/app/sign-in/page.tsx.
        // The "local" provider authenticates against the default-user row
        // using LOCAL_AUTH_PASSWORD — useful for local cockpit-app installs
        // (founder dev box, single-tenant deployments) but a brute-force
        // attack surface on the public cloud where LOCAL_AUTH_PASSWORD also
        // happens to be set for legacy reasons. Require explicit opt-in via
        // ENABLE_OWNER_KEY=1 so a stray env var on cloud can't expose this
        // path. UI gate hides the tab; this runtime gate stops direct POSTs.
        if (process.env.ENABLE_OWNER_KEY !== "1") {
          return logAuthReject("local", "user-not-found");
        }

        const supplied = credentials.password as string | undefined;
        if (!supplied) return logAuthReject("local", "missing-input");

        const user = await getDefaultUser();
        if (!user) return logAuthReject("local", "user-not-found");

        // Env var takes priority (quick local dev). Falls back to DB hash (packaged installs).
        const envPassword = process.env.LOCAL_AUTH_PASSWORD;
        const ok = envPassword
          ? supplied === envPassword
          : user.passwordHash
            ? await verifyPassword(supplied, user.passwordHash)
            : false;

        if (!ok)
          return logAuthReject(
            "local",
            envPassword || user.passwordHash ? "wrong-password" : "no-password-hash",
            user.email,
          );
        logAuthAccept("local", user.email, user.id);
        return { id: user.id, email: user.email ?? "", name: user.name ?? "Local user" };
      },
    }),
    // Used by the sign-in form for multi-user email + password authentication.
    Credentials({
      id: "email-password",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials.email as string | undefined;
        const password = credentials.password as string | undefined;
        if (!email || !password) return logAuthReject("email-password", "missing-input", email);

        const user = await getUserByEmail(email);
        if (!user) return logAuthReject("email-password", "user-not-found", email);
        if (!user.passwordHash) return logAuthReject("email-password", "no-password-hash", email);

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return logAuthReject("email-password", "wrong-password", email);
        logAuthAccept("email-password", email, user.id);
        return { id: user.id, email: user.email ?? "", name: user.name ?? "" };
      },
    }),
    // Used by the invite acceptance flow to sign in the newly-created invited user.
    Credentials({
      id: "user-password",
      name: "User password",
      credentials: {
        userId: { label: "User ID", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const userId = credentials.userId as string | undefined;
        const password = credentials.password as string | undefined;
        if (!userId || !password) return logAuthReject("user-password", "missing-input", userId);

        const user = await getUserById(userId);
        if (!user) return logAuthReject("user-password", "user-not-found", userId);
        if (!user.passwordHash) return logAuthReject("user-password", "no-password-hash", userId);

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return logAuthReject("user-password", "wrong-password", userId);
        logAuthAccept("user-password", userId, user.id);
        return { id: user.id, email: user.email ?? "", name: user.name ?? "" };
      },
    }),
    // "Sign in with X" via OAuth 1.0a. The custom flow in src/app/api/x-login/*
    // completes the 1.0a dance and sets a signed `x1_ticket` httpOnly cookie;
    // this provider verifies it and resolves the user. X OAuth2 is unusable on
    // this account (Pay-Per-Use 503s the authorize endpoint), so login uses the
    // still-free 1.0a path. The ticket — not raw credentials — is the secret, so
    // a direct POST to this provider without a valid cookie is rejected.
    Credentials({
      id: "x-1a",
      name: "X",
      credentials: {},
      async authorize(_credentials, request) {
        const cookieHeader = request?.headers?.get("cookie") ?? "";
        const match = cookieHeader.match(/(?:^|;\s*)x1_ticket=([^;]+)/);
        if (!match) return logAuthReject("x-1a", "missing-input");
        const data = verifyTicket(decodeURIComponent(match[1]));
        if (!data) return logAuthReject("x-1a", "wrong-password");
        const user = await findOrCreateTwitterUser(data.xId, data.handle);
        logAuthAccept("x-1a", data.handle, user.id);
        return { id: user.id, email: user.email ?? "", name: user.name ?? data.handle };
      },
    }),
  ],
  pages: {
    signIn: ROUTES.SIGN_IN,
    signOut: ROUTES.SIGN_OUT,
  },
  callbacks: {
    async signIn({ user, account }) {
      // CRITICAL: at this point in the OAuth flow, user.id is the OAuth provider's
      // id (e.g. GitHub's numeric "41178744"), NOT the DB UUID. Passing it to any
      // query that joins on a uuid column trips PostgreSQL — which Auth.js wraps as
      // AccessDenied. Resolve to the DB user via email before any uuid-typed write.
      // Org bootstrap (which needs the real UUID) lives in events.signIn below.
      // "oidc" too: OrangeCat's provider type is oidc, and gating on "oauth"
      // alone silently skipped this backfill for every OrangeCat sign-in.
      if ((account?.type === "oauth" || account?.type === "oidc") && user.email) {
        const existingUser = await getUserByEmail(user.email);
        if (existingUser) {
          const patch: UpdateUserInput = {};
          const oauthImage = (user as { image?: string | null }).image;
          if (!existingUser.image && oauthImage) patch.image = oauthImage;
          if (!existingUser.name && user.name) patch.name = user.name;
          // GitHub/Google only hand us an email they have already verified.
          if (!existingUser.emailVerified) patch.emailVerified = new Date();
          if (Object.keys(patch).length > 0) {
            await updateUser(existingUser.id, patch);
          }
        }
      }
      return true;
    },
    async jwt({ token, user, trigger }) {
      const email = user?.email ?? (token.email as string | undefined);
      const userId = user?.id ?? (token.id as string | undefined);

      // Fast path: reuse the cached token on normal requests to avoid a
      // per-request DB amplifier (getUserById + heal). BUT only while the token
      // still maps to a real user — a reseed/restore can orphan a valid JWT
      // (same root cause resolveSessionUserId handles for the data path). When
      // the cached id points at a wiped user, fall through to re-resolve by
      // email so the session's id + username self-heal to the real account,
      // instead of presenting stale claims (a stale username 404'd the user's
      // own /u/<username> profile even though it owned all their projects).
      if (!user?.id && trigger !== "update") {
        const cachedId = token.id as string | undefined;
        if (cachedId && isValidUuid(cachedId)) {
          const u = await getUserById(cachedId);
          // Fast path only while the cached token is fully in sync with the DB.
          // Orphaned id (reseed/restore) OR drifted username/name (e.g. the
          // operator renamed to a pseudonym) both fall through to refresh, so
          // the session — and the public /u/<username> it links to — self-heal.
          if (
            u &&
            (u.username ?? null) === (token.username ?? null) &&
            (u.name ?? null) === (token.name ?? null)
          ) {
            // emailVerified can change without a name/username edit (the
            // verify-email link). Stamp it from the row we already loaded so
            // the optional recovery banner disappears without a sign-out.
            token.emailVerified = u.emailVerified ?? null;
            return token;
          }
        }
        // else fall through to email recovery + refresh below
      }

      let dbUser = userId && isValidUuid(userId) ? await getUserById(userId) : null;
      if (!dbUser && email) {
        dbUser = await getUserByEmail(email);
      }
      if (dbUser) {
        dbUser = await healReturningUserOnboarding(dbUser);
        token.id = dbUser.id;
        token.email = dbUser.email ?? email ?? null;
        token.name = dbUser.name ?? token.name ?? null;
        token.username = dbUser.username ?? null;
        token.onboardedAt = dbUser.onboardedAt ?? null;
        token.onboardingComplete = onboardingCompleteFlag(dbUser);
        token.emailVerified = dbUser.emailVerified ?? null;
      } else if (email) {
        token.email = email;
      }
      return token;
    },
    session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: (token.id as string) ?? "",
          username: (token.username as string | null) ?? null,
          onboardedAt: (token.onboardedAt as Date | null) ?? null,
          onboardingComplete: token.onboardingComplete === true,
          emailVerified: (token.emailVerified as Date | null) ?? null,
        },
      };
    },
  },
});
