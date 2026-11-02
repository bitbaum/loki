/**
 * POST /api/notify — how any bot holding a Loki token reaches its owner: the
 * box's alerting (lib-alert.sh), OpenClaw's jobs, scripts. The contract is
 * lib/notify/policy.ts: no button, no Telegram; the notice is still recorded
 * on /today or /system. Answers what happened, so a sender can log it.
 */
import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { readJsonBody } from "@/lib/api/route-helpers";
import { deliverNotice, resolveNotice } from "@/lib/notify/deliver";
import { NoticeBody } from "@/lib/notify/schema";
import { hasBearerToken } from "@/lib/notify/bearer-only";

export async function POST(req: NextRequest) {
  if (!(await hasBearerToken()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJsonBody(req, NoticeBody);
  if (body instanceof NextResponse) return body;
  if (body.resolved) {
    await resolveNotice(userId, body.key ?? `${body.source}:${body.title}`);
    return NextResponse.json({ ok: true, resolved: true });
  }
  const result = await deliverNotice(userId, body);
  return NextResponse.json({ ok: true, ...result });
}
