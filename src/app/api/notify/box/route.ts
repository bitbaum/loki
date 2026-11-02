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

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const text = String(form?.get("text") ?? "").trim();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  const result = await deliverNotice(userId, boxNotice(text.slice(0, 2000), APP_URL));
  return NextResponse.json({ ok: true, ...result });
}
