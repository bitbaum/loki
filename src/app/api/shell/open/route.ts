/**
 * POST /api/shell/open {channel} — queue a plain shell on a builder.
 *
 * The only door to `open_shell`. Operator, PIN unlock, an online builder,
 * fewer than SHELL_MAX_OPEN already, and a rate limit — each refusal says what
 * to do next and lands on the audit trail. The tab name is minted here, never
 * taken from the client.
 */
import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z, readJsonBody } from "@/lib/api/route-helpers";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  keepShellUnlocked,
  refusalResponse,
  requestOrigin,
  requireShellAccess,
} from "@/lib/shell-access";
import { getBuilderPresence } from "@/db/queries/runner-presence";
import { getRuntimeSnapshot } from "@/db/queries/runtime-snapshots";
import { enqueueOpenShellCommand } from "@/db/queries/pending-commands";
import { recordShellAudit } from "@/db/queries/shell-audit-events";
import {
  isShellTab,
  SHELL_MAX_OPEN,
  SHELL_OPEN_LIMIT,
  shellTabFromHex,
  type ShellRefusal,
} from "@/lib/shell-session";

const Body = z.object({ channel: z.enum(BUILDER_CHANNELS) });

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  const { channel } = body;
  const caller = await requireShellAccess(req, { needUnlock: true, channel });
  if (caller instanceof NextResponse) return caller;
  const origin = requestOrigin(req);
  const refuse = async (code: ShellRefusal, status: number) => {
    await recordShellAudit({
      userId: caller.userId,
      event: "denied",
      channel,
      ...origin,
      detail: { code, at: "open" },
    });
    return refusalResponse(code, status);
  };

  if (
    !checkRateLimit(
      `shell-open:${caller.userId}`,
      SHELL_OPEN_LIMIT.limit,
      SHELL_OPEN_LIMIT.windowMs,
    )
  ) {
    return refuse("rate-limited", 429);
  }
  const [presence, snapshot] = await Promise.all([
    getBuilderPresence(caller.userId).catch(() => null),
    getRuntimeSnapshot(caller.userId, channel).catch(() => null),
  ]);
  if (!presence?.[channel]) return refuse("offline", 409);
  if ((snapshot?.openTabs ?? []).filter(isShellTab).length >= SHELL_MAX_OPEN) {
    return refuse("too-many", 409);
  }

  const tab = shellTabFromHex(randomBytes(4).toString("hex"));
  const commandId = await enqueueOpenShellCommand(caller.userId, { tab, channel });
  await recordShellAudit({ userId: caller.userId, event: "open", channel, tab, ...origin });
  const res = NextResponse.json({ ok: true, tab, channel, commandId });
  await keepShellUnlocked(caller, res);
  return res;
}
