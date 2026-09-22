import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      provider: accounts.provider,
      providerAccountId: accounts.providerAccountId,
      refreshToken: accounts.refresh_token,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId));

  return NextResponse.json({
    accounts: rows.map(({ provider, providerAccountId, refreshToken }) => ({
      provider,
      providerAccountId,
      // A LINKED account is not a WORKING one, and this page could not tell
      // the difference. OrangeCat rejected this account's refresh token on
      // 2026-09-17 and every publish stopped; Settings went on listing
      // OrangeCat as connected, with Disconnect as the only button. The one
      // action that fixes it was the one action the page did not offer.
      //
      // Only OrangeCat, deliberately: `getOrangeCatLink` clears the refresh
      // token precisely when OrangeCat has refused it, so an empty column
      // there MEANS broken. A GitHub OAuth app never issues one at all, so
      // the same test would call a healthy link broken.
      needsReconnect: provider === "orangecat" && !refreshToken,
    })),
  });
}
