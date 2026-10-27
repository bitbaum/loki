/**
 * The shell's own unlock — a cookie value, request-free and pure.
 *
 * The private-zone unlock lasts 30 minutes from the PIN and does not care
 * whether anyone is there. A shell is a stronger door, so it has its own: the
 * PIN opens it, typing keeps it open, and it shuts after SHELL_IDLE_MS of
 * silence or SHELL_UNLOCK_MAX_MS in all. The value is an HMAC under AUTH_SECRET
 * with its own domain prefix, so a private-zone cookie can never be replayed as
 * a shell unlock.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { SHELL_IDLE_MS, SHELL_UNLOCK_MAX_MS } from "@/lib/shell-session";

export const SHELL_UNLOCK_COOKIE = "loki-shell-unlock";

export type ShellUnlockState = "ok" | "idle" | "expired" | "invalid";

function secret(): string | null {
  return process.env.AUTH_SECRET?.trim() || null;
}

function sign(userId: string, issuedAt: number, lastActive: number): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac("sha256", key)
    .update(`shell-unlock:${userId}:${issuedAt}:${lastActive}`)
    .digest("base64url");
}

export function createShellUnlock(userId: string, now = Date.now()): string {
  const sig = sign(userId, now, now);
  if (!sig) throw new Error("AUTH_SECRET is required for a shell unlock");
  return `${userId}:${now}:${now}:${sig}`;
}

export function checkShellUnlock(
  token: string | undefined | null,
  userId: string,
  now = Date.now(),
): ShellUnlockState {
  if (!token || !userId) return "invalid";
  const parts = token.split(":");
  if (parts.length !== 4) return "invalid";
  const [cookieUser, issuedRaw, activeRaw, sig] = parts;
  if (cookieUser !== userId) return "invalid";
  const issuedAt = Number(issuedRaw);
  const lastActive = Number(activeRaw);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(lastActive)) return "invalid";
  const expected = sign(userId, issuedAt, lastActive);
  if (!expected) return "invalid";
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "invalid";
  if (now - issuedAt > SHELL_UNLOCK_MAX_MS) return "expired";
  if (now - lastActive > SHELL_IDLE_MS) return "idle";
  return "ok";
}

/** The same unlock, seen active now. Null when it is not valid to extend. */
export function touchShellUnlock(
  token: string | undefined | null,
  userId: string,
  now = Date.now(),
): string | null {
  if (checkShellUnlock(token, userId, now) !== "ok") return null;
  const issuedAt = Number(token!.split(":")[1]);
  const sig = sign(userId, issuedAt, now);
  return sig ? `${userId}:${issuedAt}:${now}:${sig}` : null;
}

/** Only worth a Set-Cookie when a minute has gone by. */
export function shellUnlockNeedsTouch(token: string, now = Date.now()): boolean {
  const lastActive = Number(token.split(":")[2]);
  return !Number.isFinite(lastActive) || now - lastActive > 60_000;
}

export function shellUnlockCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: Math.floor(SHELL_UNLOCK_MAX_MS / 1000),
  };
}
