import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { dismissActiveAlertsByType } from "@/db/queries/alerts";
import { carriesTokens, type OAuthTokenSet } from "./oauth-token-set";

export { carriesTokens, type OAuthTokenSet } from "./oauth-token-set";

/**
 * Store the token set an OAuth sign-in just handed us.
 *
 * WHY THIS EXISTS — it closes a door that looked open for months.
 *
 * `DrizzleAdapter.linkAccount` writes the token set exactly once: the first
 * time an account is connected. Every sign-in after that authenticates the
 * person and leaves the stored tokens untouched. So "sign in with OrangeCat
 * again" — the remedy every surface points at, and the one this app's own
 * Reconnect button triggers — could complete perfectly and repair nothing.
 *
 * Measured on prod 2026-09-22, after the owner pressed Reconnect: OrangeCat
 * had minted FIVE fresh token sets that day, none revoked, while Loki's
 * `accounts` row still held a null refresh token and an access token that had
 * expired five days earlier. The round-trip worked every time and the answer
 * was discarded every time. A stranded link therefore had no way back at all:
 * not through refresh (its token was revoked), and not through re-consent.
 *
 * Every provider, not only the one that broke. Loki stores these tokens to ACT
 * as the user, a re-authorization is the user handing over fresh ones, and
 * there is no provider for which keeping the older set is the better answer.
 * Scopes cannot narrow underneath us — each provider's are fixed in its config
 * in auth.ts, so what comes back is what we asked for.
 *
 * Fire-and-forget by contract: signing in must not fail because bookkeeping
 * did.
 */

export async function persistOAuthTokens(
  account: OAuthTokenSet | null | undefined,
  userId: string | undefined,
): Promise<void> {
  if (!account || !carriesTokens(account)) return;

  await db
    .update(accounts)
    .set({
      access_token: account.access_token,
      // `undefined` omits the column from the UPDATE rather than nulling it:
      // a provider that does not re-issue a refresh token on re-consent must
      // not cost us the one we already hold.
      refresh_token: account.refresh_token ?? undefined,
      expires_at: account.expires_at ?? null,
      token_type: account.token_type ?? undefined,
      scope: account.scope ?? undefined,
      id_token: account.id_token ?? undefined,
    })
    .where(
      and(
        eq(accounts.provider, account.provider as string),
        eq(accounts.providerAccountId, account.providerAccountId as string),
      ),
    );

  // The alarm goes down with the fault that raised it. An alert that outlives
  // its own repair teaches people to ignore the channel — and this one says
  // "publishing is paused" while publishing is working again.
  if (account.provider === "orangecat" && userId) {
    await dismissActiveAlertsByType(userId, "orangecat_link_broken");
  }
}
