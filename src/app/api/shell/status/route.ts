/**
 * GET /api/shell/status?channel=cloud|local — may this person open a shell, and
 * is it unlocked right now? Works while locked: it is what tells the screen to
 * show the PIN form (or, for anyone but the operator, nothing at all).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "@/lib/api/route-helpers";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";
import { loadShellCaller, decideShellAccess } from "@/lib/shell-access";
import { getRuntimeSnapshot } from "@/db/queries/runtime-snapshots";
import { getBuilderPresence } from "@/db/queries/runner-presence";
import { isShellTab, SHELL_IDLE_MS, SHELL_MAX_OPEN, SHELL_REFUSALS } from "@/lib/shell-session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const caller = await loadShellCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { isOperator, pinConfigured, unlock } = caller.signals;
  const channel = z.enum(BUILDER_CHANNELS).safeParse(req.nextUrl.searchParams.get("channel"));
  // Anyone else learns nothing about the machines behind it.
  if (!isOperator) {
    return NextResponse.json({ allowed: false, pinConfigured: false, unlocked: false });
  }
  const verdict = decideShellAccess(caller.signals, true);
  let online = false;
  let open = 0;
  if (channel.success) {
    const [presence, snap] = await Promise.all([
      getBuilderPresence(caller.userId).catch(() => null),
      getRuntimeSnapshot(caller.userId, channel.data).catch(() => null),
    ]);
    online = Boolean(presence?.[channel.data]);
    open = (snap?.openTabs ?? []).filter(isShellTab).length;
  }
  return NextResponse.json({
    allowed: true,
    pinConfigured,
    unlocked: unlock === "ok",
    idleMinutes: SHELL_IDLE_MS / 60_000,
    online,
    open,
    max: SHELL_MAX_OPEN,
    message: verdict.ok ? null : SHELL_REFUSALS[verdict.code],
  });
}
