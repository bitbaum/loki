/**
 * POST /api/orangecat/notify — OrangeCat's bots (the Cat's brief and watches,
 * its ops alerts, companions) reach the owner through Loki's one gateway,
 * signed with the same shared secret as the other OrangeCat webhooks. They
 * speak to the instance's operator (users.is_default): OrangeCat's
 * OPS_NOTIFY_USER_ID is the same person. Fail-closed without the secret.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDefaultUser } from "@/db/queries/users";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";
import { deliverNotice, resolveNotice } from "@/lib/notify/deliver";
import { NoticeBody } from "@/lib/notify/schema";

export async function POST(req: NextRequest) {
  const body = await readSignedOrangeCatBody(req, NoticeBody, "notify webhook not configured");
  if (body instanceof NextResponse) return body;
  const owner = await getDefaultUser();
  if (!owner) return NextResponse.json({ error: "no operator account" }, { status: 503 });
  const source = body.source.startsWith("orangecat") ? body.source : `orangecat-${body.source}`;
  if (body.resolved) {
    await resolveNotice(owner.id, body.key ?? `${source}:${body.title}`);
    return NextResponse.json({ ok: true, resolved: true });
  }
  const result = await deliverNotice(owner.id, { ...body, source });
  return NextResponse.json({ ok: true, ...result });
}
