/**
 * POST /api/shell/unlock {pin} — the PIN opens the shell for as long as someone
 * is typing (lib/shell-unlock-token.ts). DELETE locks it at once.
 *
 * The PIN is the private-zone PIN, checked the same way and rate-limited the
 * same way — per account, five a minute — and every attempt is on the audit
 * trail. Without a PIN set there is nothing to unlock with, so there is no
 * shell: the answer says how to set one.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z, readJsonBody } from "@/lib/api/route-helpers";
import { verifyPassword } from "@/lib/password";
import { getEffectivePinHash } from "@/lib/private-zone";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  loadShellCaller,
  refusalResponse,
  requestOrigin,
  decideShellAccess,
} from "@/lib/shell-access";
import { recordShellAudit } from "@/db/queries/shell-audit-events";
import { SHELL_UNLOCK_LIMIT } from "@/lib/shell-session";
import {
  SHELL_UNLOCK_COOKIE,
  createShellUnlock,
  shellUnlockCookieOptions,
} from "@/lib/shell-unlock-token";

const Body = z.object({ pin: z.string().trim().min(1).max(32) });

export async function POST(req: NextRequest) {
  const caller = await loadShellCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const origin = requestOrigin(req);
  const verdict = decideShellAccess(caller.signals, false);
  if (!verdict.ok) {
    await recordShellAudit({
      userId: caller.userId,
      event: "denied",
      ...origin,
      detail: { code: verdict.code, at: "unlock" },
    });
    return refusalResponse(verdict.code, verdict.status);
  }
  if (
    !checkRateLimit(
      `shell-unlock:${caller.userId}`,
      SHELL_UNLOCK_LIMIT.limit,
      SHELL_UNLOCK_LIMIT.windowMs,
    )
  ) {
    await recordShellAudit({
      userId: caller.userId,
      event: "denied",
      ...origin,
      detail: { code: "rate-limited", at: "unlock" },
    });
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Wait a minute." },
      { status: 429 },
    );
  }
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  const hash = await getEffectivePinHash(caller.userId);
  const valid = hash ? await verifyPassword(body.pin, hash) : false;
  if (!valid) {
    await recordShellAudit({ userId: caller.userId, event: "unlock-failed", ...origin });
    return NextResponse.json({ ok: false, error: "Incorrect PIN" }, { status: 401 });
  }
  await recordShellAudit({ userId: caller.userId, event: "unlock", ...origin });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SHELL_UNLOCK_COOKIE,
    createShellUnlock(caller.userId),
    shellUnlockCookieOptions(),
  );
  return res;
}

export async function DELETE(req: NextRequest) {
  const caller = await loadShellCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jar = await cookies();
  jar.delete(SHELL_UNLOCK_COOKIE);
  if (caller.signals.isOperator) {
    await recordShellAudit({ userId: caller.userId, event: "lock", ...requestOrigin(req) });
  }
  return NextResponse.json({ ok: true });
}
