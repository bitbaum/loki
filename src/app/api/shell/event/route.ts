/**
 * POST /api/shell/event — the BUILDER reports a shell it started or ended
 * (who ran it is the web side's record; this is the machine's: which host, how
 * it exited). Runner-token auth. Carries no content: a host name and an exit
 * code at most. Informational — the open and close rows written by the web
 * routes are the authoritative ones, because a bearer token is also something
 * an agent on the box can hold.
 */
import { NextRequest, NextResponse } from "next/server";
import { z, readJsonBody } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";
import { recordShellAudit } from "@/db/queries/shell-audit-events";
import { isShellTab } from "@/lib/shell-session";

const Body = z.object({
  tab: z.string().trim().min(1).max(40),
  event: z.enum(["started", "ended"]),
  channel: z.enum(BUILDER_CHANNELS),
  host: z.string().trim().max(120).optional(),
  user: z.string().trim().max(60).optional(),
  exitCode: z.number().int().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  if (!isShellTab(body.tab)) return NextResponse.json({ error: "Not a shell." }, { status: 400 });
  await recordShellAudit({
    userId,
    event: body.event,
    channel: body.channel,
    tab: body.tab,
    detail: {
      source: "builder",
      host: body.host ?? null,
      user: body.user ?? null,
      exitCode: body.exitCode ?? null,
    },
  });
  return NextResponse.json({ ok: true });
}
