/**
 * What an OAuth sign-in handed us, and whether it is worth storing.
 *
 * Pure — no db, no network — so the DB-free unit suite can exercise the
 * predicate that decides whether a sign-in overwrites a stored credential.
 * Same split as orangecat-run-moment.ts: the decision here, the write next
 * door in persist-oauth-tokens.ts.
 */

/** The slice of Auth.js's `account` this needs — structural on purpose, so an
 *  adapter-types reshape cannot quietly change what gets written. */
export interface OAuthTokenSet {
  provider?: string;
  providerAccountId?: string;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  token_type?: string | null;
  scope?: string | null;
  id_token?: string | null;
}

/**
 * True when this sign-in carried credentials worth storing.
 *
 * A Credentials sign-in carries none — there is nothing to act with — and an
 * OAuth callback that somehow arrived without an access token is not a set:
 * writing it would replace a working link with an empty one. Both halves of
 * the primary key must be present or there is no row to address.
 */
export function carriesTokens(account: OAuthTokenSet | null | undefined): boolean {
  return Boolean(account?.provider && account.providerAccountId && account.access_token);
}
