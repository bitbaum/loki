import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET — the VAPID public key, read from the server's own env at request time.
 *
 * The browser used to read NEXT_PUBLIC_VAPID_PUBLIC_KEY, which is inlined at
 * BUILD time: a build without it, or with a stale copy, produced a phone that
 * subscribed against a key the server cannot sign for — a push that is
 * accepted by the push service and never shown. One source (the same
 * VAPID_PUBLIC_KEY the server signs with) cannot disagree with itself. The key
 * is public by design; it is gated to signed-in users only to keep the route
 * out of anonymous noise.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const publicKey = (process.env.VAPID_PUBLIC_KEY ?? "").trim();
  if (!publicKey) return NextResponse.json({ error: "Push is not configured" }, { status: 503 });
  return NextResponse.json({ publicKey });
}
