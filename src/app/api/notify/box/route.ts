/**
 * POST /api/notify/box — the box's alerting (lib-alert.sh's _alert_deliver)
 * hands its line here as form field `text`, with the box's Loki agent token.
 * lib/notify/box.ts decides what it is; the notify gateway decides whether it
 * reaches the phone (almost never). Form-encoded because that is what a
 * shell script can send without building JSON.
 */
import { NextRequest, NextResponse } from "next/server";
import { APP_URL } from "@/config/brand";
import { getApiUserId } from "@/lib/session";
import { deliverNotice } from "@/lib/notify/deliver";
import { boxNotice } from "@/lib/notify/box";
import { hasBearerToken } from "@/lib/notify/bearer-only";

export async function POST(req: NextRequest) {
  if (!(await hasBearerToken()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const text = String(form?.get("text") ?? "").trim();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  const notice = boxNotice(text.slice(0, 2000), APP_URL);
  const result = await deliverNotice(userId, notice);
  // A 2xx tells the box "handled" and stops its own fallback. So when the line
  // was not even recorded (database down), or an urgent one did not reach the
  // phone for any reason but "already told", answer 503: the box then sends
  // the intrusion to Telegram directly, which is what that fallback is for.
  const urgentLost = notice.urgency === "now" && !result.sent && result.why !== "held-reminder";
  if (!result.alertId || urgentLost) {
    return NextResponse.json({ ok: false, ...result }, { status: 503 });
  }
  return NextResponse.json({ ok: true, ...result });
}
