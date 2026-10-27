/**
 * Who may reach a plain shell, decided in one place.
 *
 * Three things must all be true, and each is checked on the server for every
 * request that opens, reads or types into a shell — a screen that hides the
 * button is a courtesy, not a gate:
 *
 *  1. The caller is a signed-in PERSON (a browser session) — never a `ck_`
 *     agent token or a runner token, which the prompt-injectable agents on the
 *     box can hold.
 *  2. The account is the OPERATOR's: the one that owns the builder
 *     (`isFleetInfrastructureAllowed`). A builder seat, a client, a guest or a
 *     share link is never this.
 *  3. A PIN is set and was entered recently (shell-unlock-token.ts: idle 10
 *     minutes, 60 at most). No PIN means no shell, not an open one.
 */
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { isFleetInfrastructureAllowed } from "@/lib/execution-access";
import { isPrivateZoneConfigured } from "@/lib/private-zone";
import { getClientIp } from "@/lib/rate-limit";
import { recordShellAudit } from "@/db/queries/shell-audit-events";
import {
  SHELL_REFUSALS,
  decideShellAccess,
  type ShellRefusal,
  type ShellSignals,
} from "@/lib/shell-session";
export { decideShellAccess };
import {
  SHELL_UNLOCK_COOKIE,
  checkShellUnlock,
  shellUnlockCookieOptions,
  shellUnlockNeedsTouch,
  touchShellUnlock,
} from "@/lib/shell-unlock-token";

export function refusalResponse(code: ShellRefusal, status: number): NextResponse {
  return NextResponse.json({ error: SHELL_REFUSALS[code], code }, { status });
}

export function requestOrigin(req: NextRequest): { ip: string; userAgent: string | null } {
  return { ip: getClientIp(req), userAgent: req.headers.get("user-agent") };
}

export type ShellCaller = { userId: string; token: string | undefined; signals: ShellSignals };

export async function loadShellCaller(): Promise<ShellCaller | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const jar = await cookies();
  const token = jar.get(SHELL_UNLOCK_COOKIE)?.value;
  const [isOperator, pinConfigured] = await Promise.all([
    isFleetInfrastructureAllowed(userId).catch(() => false),
    isPrivateZoneConfigured(userId).catch(() => false),
  ]);
  return {
    userId,
    token,
    signals: { isOperator, pinConfigured, unlock: checkShellUnlock(token, userId) },
  };
}

/**
 * Gate a shell route. Returns the caller, or the response to send. A refusal
 * is written to the audit trail unless `quiet` (keystroke posts: a locked
 * phone would otherwise write a row per key).
 */
export async function requireShellAccess(
  req: NextRequest,
  opts: { needUnlock: boolean; quiet?: boolean; channel?: "cloud" | "local" | null; tab?: string },
): Promise<ShellCaller | NextResponse> {
  const caller = await loadShellCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const verdict = decideShellAccess(caller.signals, opts.needUnlock);
  if (verdict.ok) return caller;
  if (!opts.quiet) {
    await recordShellAudit({
      userId: caller.userId,
      event: "denied",
      channel: opts.channel ?? null,
      tab: opts.tab ?? null,
      ...requestOrigin(req),
      detail: { code: verdict.code },
    });
  }
  return refusalResponse(verdict.code, verdict.status);
}

/** Typing counts as being there: slide the unlock forward (at most once a
 *  minute, so a held key is not a Set-Cookie per byte). */
export async function keepShellUnlocked(caller: ShellCaller, res: NextResponse): Promise<void> {
  if (!caller.token || !shellUnlockNeedsTouch(caller.token)) return;
  const next = touchShellUnlock(caller.token, caller.userId);
  if (next) res.cookies.set(SHELL_UNLOCK_COOKIE, next, shellUnlockCookieOptions());
}
