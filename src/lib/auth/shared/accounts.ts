/**
 * A person AccountKit created itself (a first OrangeCat or bitbaum sign-in)
 * gets Loki's `users` row under the same id and their personal org, so every
 * Loki table can reference them. Linking OrangeCat to an existing person
 * records the actor id, as the Auth.js signIn event does. OrangeCat's and
 * GitHub's tokens go to Loki's `accounts`, where publish, promote, the wallet
 * and the GitHub features read them (AccountKit itself stores no provider
 * token). Idempotent: AccountKit may call this more than once for one person.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { CreatedAccount } from "@bitbaum/accountkit/auth/server";
import { ORANGECAT_PROVIDER_ID } from "@bitbaum/accountkit/orangecat";
import { db } from "@/db";
import { authUsers } from "@/db/schema/accountkit";
import { accounts, users } from "@/db/schema";
import { isValidUuid } from "@/lib/utils";
import { bootstrapAfterSignIn } from "../bootstrap";

export async function ensureLokiUser(account: CreatedAccount): Promise<void> {
  await ensureRow(account);
  await keepProviderTokens(account);
}

async function ensureRow(account: CreatedAccount): Promise<void> {
  const actorId =
    account.providerId === ORANGECAT_PROVIDER_ID && isValidUuid(account.accountId)
      ? account.accountId
      : null;
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, account.userId))
    .limit(1);
  if (existing) {
    if (actorId) {
      await db
        .update(users)
        .set({ orangecatActorId: actorId, updatedAt: new Date() })
        .where(and(eq(users.id, account.userId), isNull(users.orangecatActorId)));
    }
    return;
  }
  const [shared] = await db
    .select({ email: authUsers.email, name: authUsers.name, verified: authUsers.emailVerified })
    .from(authUsers)
    .where(eq(authUsers.id, account.userId))
    .limit(1);
  if (!shared) return;
  // An address from a provider is never proof (AccountKit gives OIDC people a
  // `.invalid` placeholder), and Loki keeps no placeholder: such a person has
  // no address until they add one.
  const email = shared.email.endsWith(".invalid") ? null : shared.email;
  await db
    .insert(users)
    .values({
      id: account.userId,
      email,
      name: shared.name || null,
      emailVerified: shared.verified && email ? new Date() : null,
      orangecatActorId: actorId,
    })
    .onConflictDoNothing();
  await bootstrapAfterSignIn({ id: account.userId, name: shared.name, email });
}

/** The Auth.js account type each provider whose token Loki acts with was stored under. */
const TOKEN_PROVIDERS: Record<string, "oidc" | "oauth"> = {
  [ORANGECAT_PROVIDER_ID]: "oidc",
  github: "oauth",
};

/**
 * A provider's token set, as the Auth.js adapter kept it. A refresh token is
 * replaced, never blanked.
 */
async function keepProviderTokens({ userId, providerId, accountId, tokens }: CreatedAccount) {
  const type = TOKEN_PROVIDERS[providerId];
  if (!type || !tokens?.accessToken) return;
  const expiresAt = tokens.accessTokenExpiresAt
    ? Math.floor(tokens.accessTokenExpiresAt.getTime() / 1000)
    : null;
  await db
    .insert(accounts)
    .values({
      userId,
      type,
      provider: providerId,
      providerAccountId: accountId,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: expiresAt,
      token_type: "bearer",
      scope: tokens.scope,
      id_token: tokens.idToken,
    })
    .onConflictDoUpdate({
      target: [accounts.provider, accounts.providerAccountId],
      set: {
        access_token: tokens.accessToken,
        refresh_token: sql`coalesce(excluded.refresh_token, ${accounts.refresh_token})`,
        expires_at: sql`coalesce(excluded.expires_at, ${accounts.expires_at})`,
        scope: sql`coalesce(excluded.scope, ${accounts.scope})`,
        id_token: sql`coalesce(excluded.id_token, ${accounts.id_token})`,
      },
    });
}
