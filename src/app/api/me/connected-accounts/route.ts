import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrangeCatLink } from "@/lib/integrations/orangecat-identity";
import { githubTokenWorks } from "@/lib/github-token";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      provider: accounts.provider,
      providerAccountId: accounts.providerAccountId,
      scope: accounts.scope,
      expiresAt: accounts.expires_at,
      hasRefresh: accounts.refresh_token,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId));

  /**
   * ASK, don't assume.
   *
   * A row in `accounts` proves somebody once connected OrangeCat; it says
   * nothing about whether the link still works. The first version of this
   * checked whether the refresh token column was empty — which reads as a
   * health check and is not one, because the column is only emptied once a
   * refresh has actually been attempted and refused. Measured on prod the day
   * it shipped: the link had been dead for five days, the revoked token was
   * still sitting in the column, and the page said "Connected" in green.
   *
   * So resolve the link the way every publish does. `getOrangeCatLink` returns
   * a usable access token or null, refreshing if it must — and when OrangeCat
   * refuses, it retires the dead credential and raises the alert on its way
   * out. Being signed IN with OrangeCat does not repair this and never did:
   * the session cookie and the stored OAuth token set are different things,
   * which is exactly why a person can be looking at a Loki they logged into
   * through OrangeCat while Loki cannot speak to OrangeCat at all.
   *
   * One network call at most, only for the owner of the account, only on a
   * page they opened to look at this. The cost of asking is a settings page
   * that is slightly slower; the cost of not asking is five silent days.
   */
  const orangeCat = rows.find((r) => r.provider === "orangecat");
  const orangeCatWorks = orangeCat ? Boolean(await getOrangeCatLink(userId)) : false;

  /**
   * GitHub gets the same question, because the note that used to live here —
   * "the others are sign-in only" — was false. The GitHub link carries `repo`
   * scope (full read/write on private repositories) and Loki acts through it
   * in six places: /api/github/repos, projects/[id]/enrich, bulk-from-github,
   * project-dossier, github-org-token and reap-evidence. A revoked token
   * breaks all six silently while this page shows "Connected" in green, which
   * is exactly the failure the OrangeCat check exists to prevent.
   */
  const github = rows.find((r) => r.provider === "github");
  const githubWorks = github ? await githubTokenWorks(userId) : false;

  /**
   * Google really IS sign-in only — its scopes are openid/userinfo.email/
   * userinfo.profile, which grant Loki nothing it can act with. So a dead
   * Google token breaks nothing and "reconnect" would fix nothing.
   *
   * But it must not claim "Connected" either. Measured 2026-09-22: the stored
   * Google token had expired on 2026-06-29 — three months — and the row was
   * green. `capability` lets the UI say what a link actually is instead of
   * implying every row is a live connection.
   */
  const SIGN_IN_ONLY = new Set(["google"]);

  return NextResponse.json({
    accounts: rows.map(({ provider, providerAccountId, scope }) => ({
      provider,
      providerAccountId,
      scope: scope ?? null,
      // What the link is FOR — so the UI can stop implying that a sign-in
      // record and a live capability token are the same kind of thing.
      capability: SIGN_IN_ONLY.has(provider) ? ("sign-in" as const) : ("acts" as const),
      // Only asked of the links Loki actually acts through. A sign-in-only
      // provider cannot be "broken" in a way a reconnect would repair.
      needsReconnect:
        (provider === "orangecat" && !orangeCatWorks) || (provider === "github" && !githubWorks),
    })),
  });
}
