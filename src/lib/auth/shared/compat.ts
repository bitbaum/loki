/**
 * Loki's screens on the shared runtime, unchanged: AccountKit's
 * next-auth/react compat layer, given what is Loki's own
 * (docs/architecture/accountkit-migration.md):
 *
 * - the session shape, re-read from `users` on every request, so a rename, a
 *   finished onboarding or a reseeded (deleted) account applies at once;
 * - three password forms: email, the invite's user id, and the owner key
 *   (against the stored hash only; an env-only LOCAL_AUTH_PASSWORD install
 *   stays on Auth.js);
 * - the refusal log (onboarding heal and the personal org run for every new
 *   session in the runtime, ./sign-in-hook).
 *
 * GitHub, Google and X are Auth.js providers. AccountKit reaches them only
 * through the bitbaum sign-in, so they are not offered here; their buttons
 * hide because getEnabledAuthProviders knows the runtime.
 */
import type { Session } from "next-auth";
import { createNextAuthCompat } from "@bitbaum/accountkit/auth/nextauth-compat";
import type { AuthSession } from "@bitbaum/accountkit/auth/next";
import { ROUTES } from "@/config/auth";
import { isDemoEmail } from "@/config/demo";
import { logDebug } from "@/db/queries/debug-logs";
import { tokenSessionState } from "@/db/queries/token-sessions";
import { getDefaultUser, getUserById } from "@/db/queries/users";
import { onboardingCompleteFlag } from "@/lib/onboarding-heal";
import { sharedAuth, siteUrl } from "./runtime";

/**
 * A session opened with an agent's token (lib/auth/token-session.ts) is marked
 * `viaToken`, and reads as signed out once that token is revoked or expires.
 * A database without the token_sessions table yet (before migration 0138) has
 * no such sessions, so it reads every session as a person's.
 */
async function tokenSession(sessionId: string): Promise<{ live: boolean } | null> {
  try {
    return await tokenSessionState(sessionId);
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).cause?.code;
    if (code === "42P01" || (error as { code?: string }).code === "42P01") return null;
    throw error;
  }
}

async function lokiSession(shared: AuthSession): Promise<Session | null> {
  const [row, viaToken] = await Promise.all([
    getUserById(shared.user.id),
    tokenSession(shared.session.id),
  ]);
  if (!row) return null;
  if (viaToken && !viaToken.live) return null;
  return {
    user: {
      id: row.id,
      name: row.name ?? null,
      email: row.email ?? null,
      image: row.image ?? null,
      username: row.username ?? null,
      onboardedAt: row.onboardedAt ?? null,
      onboardingComplete: onboardingCompleteFlag(row),
      emailVerified: row.emailVerified ?? null,
      isDemo: isDemoEmail(row.email),
      ...(viaToken ? { viaToken: true } : {}),
    },
    expires: new Date(shared.session.expiresAt).toISOString(),
  };
}

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export const compat = createNextAuthCompat<Session>({
  runtime: sharedAuth,
  siteUrl: () => siteUrl(),
  signInPath: ROUTES.SIGN_IN,
  // Loki's sign-in, sign-up, recovery and account pages are AccountKit's own
  // screens (src/components/auth/AccountKitAuth.tsx): every AccountKit
  // endpoint opens, and next-auth/react on the other pages keeps working.
  screens: "accountkit",
  landing: "/",
  toSession: (shared) => lokiSession(shared),
  credentials: {
    "email-password": {
      name: "Email and password",
      resolve: async (form) => (field(form, "email") ? { email: field(form, "email") } : null),
    },
    "user-password": {
      name: "User password",
      resolve: async (form) => {
        const email = field(form, "userId")
          ? (await getUserById(field(form, "userId")))?.email
          : null;
        return email ? { email } : null;
      },
    },
    ...(process.env.ENABLE_OWNER_KEY === "1"
      ? {
          local: {
            name: "Local access",
            resolve: async () => {
              const email = (await getDefaultUser())?.email;
              return email ? { email } : null;
            },
          },
        }
      : {}),
  },
  // Onboarding heal and the personal org run for every new session in the
  // runtime itself (./sign-in-hook), so not a second time here.
  onRefused: async ({ provider, email, status }) => {
    await logDebug({
      source: "auth.authorize",
      level: "warn",
      message: `credentials rejected: ${provider} / accountkit ${status}`,
      meta: { provider, identifier: email },
    });
  },
});
