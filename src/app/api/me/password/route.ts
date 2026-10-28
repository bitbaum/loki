import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getUserById, updateUserPasswordHash } from "@/db/queries/users";
import { hashPassword, verifyPassword } from "@/lib/password";
import { denyDemoInHandler } from "@/lib/demo-guard";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { passwordSchema } from "@/lib/password-schema";

// Shared budget for any password mutation (change OR initial-set) per client.
// Both paths verify or establish the account credential, so they share one
// bucket — an attacker can't dodge the limit by switching between them.
const LIMIT = 10;
const WINDOW = RATE_LIMIT_WINDOW_LONG_MS;

const ChangeBody = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: passwordSchema,
});

const SetBody = z.object({
  newPassword: passwordSchema,
});

function rateLimited(req: NextRequest, userId: string): NextResponse | null {
  if (!checkRateLimit(`password:${userId}:${getClientIp(req)}`, LIMIT, WINDOW)) {
    return NextResponse.json(
      { error: "Too many password attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }
  return null;
}

/** Change an existing password — requires the correct current password. */
export async function PATCH(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The demo account's password is published on the sign-in page; changing it
  // would lock out every future visitor. The route policy already blocks this
  // path, but a credential mutation is worth guarding where it happens rather
  // than only where it is routed.
  const demoDenied = await denyDemoInHandler(userId, "credentials");
  if (demoDenied) return demoDenied;

  const limited = rateLimited(req, userId);
  if (limited) return limited;

  const dataOrResp = await readJsonBody(req, ChangeBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { currentPassword, newPassword } = dataOrResp;

  const user = await getUserById(userId);
  if (!user?.passwordHash) {
    return NextResponse.json(
      { error: "No password on this account — set one first." },
      { status: 400 },
    );
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);
  await updateUserPasswordHash(userId, passwordHash);

  return NextResponse.json({ ok: true });
}

/**
 * Set an INITIAL password for an OAuth-only account that has none yet.
 *
 * Deliberately does NOT require a current password — there is none. The
 * authenticated session itself is the proof of ownership, so this is safe.
 * Guarded so it can ONLY create a missing password: if the account already
 * has a passwordHash, this returns 409 and the caller must use PATCH (which
 * verifies the current password). That guard is what prevents this from
 * becoming an unauthenticated/no-proof password-reset for existing passwords.
 */
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The demo account's password is published on the sign-in page; changing it
  // would lock out every future visitor. The route policy already blocks this
  // path, but a credential mutation is worth guarding where it happens rather
  // than only where it is routed.
  const demoDenied = await denyDemoInHandler(userId, "credentials");
  if (demoDenied) return demoDenied;

  const limited = rateLimited(req, userId);
  if (limited) return limited;

  const dataOrResp = await readJsonBody(req, SetBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { newPassword } = dataOrResp;

  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.passwordHash) {
    return NextResponse.json(
      { error: "A password already exists — use change password instead." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(newPassword);
  await updateUserPasswordHash(userId, passwordHash);

  return NextResponse.json({ ok: true });
}
