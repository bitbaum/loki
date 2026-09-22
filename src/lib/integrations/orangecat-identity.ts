/**
 * OrangeCat identity bridge — per-user access tokens from "Login with OrangeCat".
 *
 * When a user signs in (or connects) with OrangeCat, the Auth.js adapter stores
 * the OIDC token set on their `accounts` row (provider = "orangecat"). Those
 * tokens carry the one-consent capability scopes (project.write,
 * timeline.write, …), so acting on OrangeCat AS THE USER means presenting that
 * access token — not the studio-wide ORANGECAT_API_KEY service key.
 *
 * OrangeCat rotates refresh tokens on every use (the old one is revoked), so a
 * successful refresh MUST persist both new tokens before returning; losing the
 * new refresh token strands the link until the user signs in again.
 *
 * THAT IS NOT HYPOTHETICAL — it happened, and it took the public wall with it.
 * Measured on prod 2026-09-21: OrangeCat rotated this link at 2026-09-17
 * 07:42:44 and issued a replacement refresh token that is still valid and was
 * never used; Loki kept presenting the one that rotation REVOKED at that same
 * instant. Every refresh since answered 400, so `getOrangeCatLink` returned
 * null, so every promote was skipped as "feature unavailable". The last thing
 * to reach anyone's OrangeCat wall was posted eight minutes before that
 * access token expired — and the only trace was 66 `console.warn` lines on
 * the box, because a stranded link had no way to say so.
 *
 * Three things here answer that, and each is a rule rather than a repair:
 *
 *   1. One refresh at a time per account (`inFlight`). The promote path is
 *      fire-and-forget and the backfill cron fires up to 50 of them at once;
 *      50 concurrent refreshes present the SAME token, one rotates it and the
 *      other 49 are told invalid_grant. A burst was therefore guaranteed to
 *      look like a broken link. The loser now waits for the winner and re-reads
 *      the row instead of racing it.
 *   2. A spent refresh token is never written back. `?? account.refresh_token`
 *      looks defensive and is the opposite: the old token is revoked the moment
 *      it is used, so keeping it stores a credential that can only ever fail.
 *   3. A dead link raises an alert. Re-linking needs a human click, and nobody
 *      can click what nobody can see.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { refreshOrInsertActiveAlert } from "@/db/queries/alerts";
import { ORANGECAT_BASE_FALLBACK } from "./orangecat";

const ISSUER = process.env.ORANGECAT_OAUTH_ISSUER ?? ORANGECAT_BASE_FALLBACK;
/** Refresh when less than this many seconds of validity remain. */
const EXPIRY_SLACK_SECS = 60;

export interface OrangeCatLink {
  /** The user's OrangeCat actor id (OIDC sub). */
  actorId: string;
  /** A currently-valid access token for OC API calls. */
  accessToken: string;
}

/**
 * Refreshes in progress, keyed by user. A rotating refresh token cannot be
 * used twice, so two concurrent refreshes of one link are not a race that
 * resolves — they are one success and one permanently-dead credential.
 */
const inFlight = new Map<string, Promise<OrangeCatLink | null>>();

/**
 * Resolve a valid OrangeCat access token for a Loki user, refreshing
 * (with rotation) when expired. Returns null when the user has never linked
 * OrangeCat or the link is broken (revoked / failed refresh) — callers treat
 * null as "feature unavailable", never as an error.
 */
export async function getOrangeCatLink(userId: string): Promise<OrangeCatLink | null> {
  const usable = await readUsableLink(userId);
  if (usable) return usable;

  const running = inFlight.get(userId);
  if (running) return running;

  const attempt = refreshLink(userId).finally(() => inFlight.delete(userId));
  inFlight.set(userId, attempt);
  return attempt;
}

/** The stored access token, when it is still valid for long enough to use. */
async function readUsableLink(userId: string): Promise<OrangeCatLink | null> {
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, "orangecat")),
  });
  if (!account?.access_token || !account.expires_at) return null;
  const nowSecs = Math.floor(Date.now() / 1000);
  if (account.expires_at <= nowSecs + EXPIRY_SLACK_SECS) return null;
  return { actorId: account.providerAccountId, accessToken: account.access_token };
}

async function refreshLink(userId: string): Promise<OrangeCatLink | null> {
  // Re-read inside the critical section: whoever we queued behind may already
  // have rotated the link, and replaying their spent token would kill it.
  const usable = await readUsableLink(userId);
  if (usable) return usable;

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, "orangecat")),
  });
  if (!account?.refresh_token) return null;

  const clientId = process.env.ORANGECAT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ORANGECAT_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const nowSecs = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(`${ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: account.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn("[orangecat-identity] token refresh failed", {
        userId,
        status: res.status,
      });
      // 400 is RFC 6749's invalid_grant: OrangeCat has looked this token up and
      // will never accept it (unknown, expired, or revoked by a rotation whose
      // replacement we lost). Retrying it is the loop that logged 66 times and
      // told nobody, so retire the credential and say so out loud. A 401
      // (invalid_client) and a 5xx are NOT the token's fault — those are left
      // alone so an OrangeCat outage cannot unlink a healthy account.
      if (res.status === 400) await markLinkBroken(userId);
      return null;
    }
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;

    if (!data.refresh_token) {
      // The token we just presented is spent either way. Storing it back would
      // leave a link that looks connected and can never refresh again.
      console.warn("[orangecat-identity] rotation returned no refresh token", { userId });
      await markLinkBroken(userId);
      return { actorId: account.providerAccountId, accessToken: data.access_token };
    }

    // Persist BEFORE returning — OC revoked the old refresh token the moment
    // it was used, so this write is what keeps the link alive.
    await db
      .update(accounts)
      .set({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_in ? nowSecs + data.expires_in : null,
      })
      .where(
        and(
          eq(accounts.provider, "orangecat"),
          eq(accounts.providerAccountId, account.providerAccountId),
        ),
      );

    return { actorId: account.providerAccountId, accessToken: data.access_token };
  } catch (err) {
    console.warn("[orangecat-identity] token refresh errored", { userId, err });
    return null;
  }
}

/**
 * Retire a refresh token OrangeCat will not accept, and raise the alarm.
 *
 * Clearing the column is what stops the retry loop: with no refresh token the
 * link reads as "needs reconnecting" instead of re-presenting a revoked
 * credential on every promote. The access token is left in place — it may have
 * minutes of validity left, and half a working link beats none.
 *
 * Alert, not just a log line: only the owner can fix this (the OAuth consent
 * screen needs a click), so the one thing the failure must do is reach them.
 */
async function markLinkBroken(userId: string): Promise<void> {
  try {
    await db
      .update(accounts)
      .set({ refresh_token: null })
      .where(and(eq(accounts.userId, userId), eq(accounts.provider, "orangecat")));

    await refreshOrInsertActiveAlert({
      userId,
      type: "orangecat_link_broken",
      severity: "warning",
      title: "Reconnect OrangeCat — publishing is paused",
      description:
        "OrangeCat rejected this account's refresh token, so nothing Loki builds is reaching its OrangeCat page: project publishes, dev-log entries and closed runs are all being skipped. Sign in with OrangeCat again in Settings to restore it.",
      actionUrl: "/settings",
    });
  } catch (err) {
    // Never let the bookkeeping fail the caller: the caller already has its
    // answer (no usable link), and this is only how the answer gets seen.
    console.warn("[orangecat-identity] could not record broken link", { userId, err });
  }
}

/** True when the user has a linked OrangeCat actor (cheap column check). */
export async function isOrangeCatLinked(userId: string): Promise<boolean> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { orangecatActorId: true },
  });
  return Boolean(row?.orangecatActorId);
}
