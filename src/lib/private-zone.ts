import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { PRIVATE_ZONE_COOKIE, LEGACY_PRIVATE_ZONE_COOKIE } from "@/config/brand-storage";
import { PRIVATE_ZONE_TTL_MS, verifyPrivateZoneCookieValue } from "@/lib/private-zone-token";

export { PRIVATE_ZONE_COOKIE } from "@/config/brand-storage";

// The cookie format lives in `private-zone-token.ts` — request-free, so the prod
// smoke and UI dogfood can mint the same value instead of skipping the private
// half of the app. Re-exported here so callers keep one import site.
export {
  PRIVATE_ZONE_TTL_MS,
  createPrivateZoneCookieValue,
  verifyPrivateZoneCookieValue,
} from "@/lib/private-zone-token";

/**
 * Resolve the effective PIN hash for a user.
 *
 * Per-user hashes live on `users.private_zone_pin_hash` and are the canonical
 * source. The legacy `PRIVATE_ZONE_PIN_HASH` env var is honoured only when a
 * user has no PIN of their own — a transitional fallback so the founder's
 * existing env-managed PIN keeps working until they set one in-app. This is
 * deliberately deprecated; new users should set their PIN through Settings →
 * Privacy.
 *
 * `cache()` dedupes the DB lookup within a single request — important when
 * many components on Today / System all call into the gate helpers.
 */
export const getEffectivePinHash = cache(async (userId: string): Promise<string | null> => {
  const rows = await db
    .select({ hash: users.privateZonePinHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const userHash = rows[0]?.hash?.trim() ?? null;
  if (userHash) return userHash;
  const envHash = process.env.PRIVATE_ZONE_PIN_HASH?.trim();
  return envHash || null;
});

export async function isPrivateZoneConfigured(userId: string): Promise<boolean> {
  return Boolean(await getEffectivePinHash(userId));
}

export async function isPrivateZoneUnlocked(userId: string): Promise<boolean> {
  // No PIN configured → no gate, always "unlocked".
  if (!(await isPrivateZoneConfigured(userId))) return true;
  // Outside a request (a server-run kickoff continuing after its response)
  // there is no cookie jar to read, and "no proof of unlock" is locked — the
  // same answer as a missing cookie, never an exception that fails the caller.
  let jar: Awaited<ReturnType<typeof cookies>>;
  try {
    jar = await cookies();
  } catch {
    return false;
  }
  const token = jar.get(PRIVATE_ZONE_COOKIE)?.value ?? jar.get(LEGACY_PRIVATE_ZONE_COOKIE)?.value;
  if (!token) return false;
  return verifyPrivateZoneCookieValue(token, userId);
}

/**
 * Single-call helper for components that just need to know "should I hide
 * private data right now?" — returns true when the PIN is set AND the gate
 * is still locked. One DB hit per request thanks to React's cache().
 */
export async function isPrivateZoneLocked(userId: string): Promise<boolean> {
  if (!(await isPrivateZoneConfigured(userId))) return false;
  return !(await isPrivateZoneUnlocked(userId));
}

/**
 * API routes for people / money / habits / events.
 * Returns a 403 NextResponse when PIN is required but missing/invalid.
 */
export async function guardPrivateZoneApi(userId: string): Promise<NextResponse | null> {
  if (!(await isPrivateZoneConfigured(userId))) return null;
  if (await isPrivateZoneUnlocked(userId)) return null;
  return NextResponse.json(
    { error: "Private zone locked — enter your PIN first.", code: "private_zone_locked" },
    { status: 403 },
  );
}

export function privateZoneCookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true as const,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(PRIVATE_ZONE_TTL_MS / 1000),
  };
}
