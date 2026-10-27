/**
 * POST /api/shell/close {tab, channel} — end a shell. Works while locked (ending
 * a shell is never the dangerous direction) but only for the operator, and is
 * on the audit trail like the open.
 */
import { NextRequest, NextResponse } from "next/server";
import { z, readJsonBody } from "@/lib/api/route-helpers";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";
import { requestOrigin, requireShellAccess } from "@/lib/shell-access";
import { enqueueTabCommand } from "@/db/queries/pending-commands";
import { recordShellAudit } from "@/db/queries/shell-audit-events";
import { forgetScreen } from "@/lib/sse-bus";
import { isShellTab } from "@/lib/shell-session";

const Body = z.object({ tab: z.string().trim().min(1).max(40), channel: z.enum(BUILDER_CHANNELS) });

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  if (!isShellTab(body.tab)) return NextResponse.json({ error: "Not a shell." }, { status: 400 });
  const caller = await requireShellAccess(req, {
    needUnlock: false,
    channel: body.channel,
    tab: body.tab,
  });
  if (caller instanceof NextResponse) return caller;
  forgetScreen(caller.userId, body.tab);
  const commandId = await enqueueTabCommand(caller.userId, "close_tab", {
    tab: body.tab,
    channel: body.channel,
  });
  await recordShellAudit({
    userId: caller.userId,
    event: "close",
    channel: body.channel,
    tab: body.tab,
    ...requestOrigin(req),
  });
  return NextResponse.json({ ok: true, commandId });
}
