import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrangeCatLink } from "@/lib/integrations/orangecat-identity";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      provider: accounts.provider,
      providerAccountId: accounts.providerAccountId,
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

  return NextResponse.json({
    accounts: rows.map(({ provider, providerAccountId }) => ({
      provider,
      providerAccountId,
      // Scoped to OrangeCat: it is the provider Loki holds a capability token
      // for and acts through. The others are sign-in only — nothing here can
      // be broken in a way this page could detect or a reconnect would fix.
      needsReconnect: provider === "orangecat" && !orangeCatWorks,
    })),
  });
}
