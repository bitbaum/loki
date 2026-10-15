import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { pushToUser } from "@/lib/push-fanout";
import { PUSH_TAG_PREFIX } from "@/config/brand-storage";

export const dynamic = "force-dynamic";

/**
 * POST — send one test notification to every device the caller has subscribed.
 *
 * "Turn on notifications" without a way to see that it works is the same dead
 * end as no button at all: the person cannot tell a working channel from a
 * silent one until the day it matters. The answer names which precondition
 * failed (`reason`), never a bare zero.
 */
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await pushToUser(userId, {
    title: "Loki · notifications work",
    body: "This is the test you asked for. A new report or a fix that needs you will arrive like this.",
    url: "/feedback",
    tag: `${PUSH_TAG_PREFIX}test`,
  });
  return NextResponse.json({ ok: result.sent > 0, ...result });
}
