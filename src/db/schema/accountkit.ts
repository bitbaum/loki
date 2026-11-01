import { createAuthTables } from "@bitbaum/accountkit/auth/schema";

/**
 * AccountKit's account tables under the `auth_` prefix, beside Auth.js's own
 * `users` / `accounts` / `sessions`. Read and written only by the shared
 * runtime (src/lib/auth/shared/), which is off until AUTH_RUNTIME=accountkit.
 * See docs/ACCOUNTKIT-MIGRATION.md.
 */
export const authTables = createAuthTables("auth_");

export const {
  user: authUsers,
  account: authAccounts,
  session: authSessions,
  verification: authVerifications,
  passkey: authPasskeys,
  twoFactor: authTwoFactors,
} = authTables;
