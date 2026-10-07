import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { getUserByEmail } from "@/db/queries/users";
import { lokiMayReceivePasswordReset } from "@/lib/auth/reset-eligibility";
import { createPasswordReset } from "@/db/queries/passwordResets";
import { sendEmail, resetPasswordEmailTemplate, appUrl } from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isDemoEmailBlocked } from "@/lib/demo-guard";
import { RATE_LIMIT_WINDOW_SHORT_MS } from "@/lib/constants/time";

const Body = z.object({
  email: z.string().trim().email().toLowerCase(),
});

const LIMIT = 5; // max reset requests
const WINDOW = RATE_LIMIT_WINDOW_SHORT_MS;

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`forgot:${getClientIp(req)}`, LIMIT, WINDOW)) {
    return NextResponse.json(
      { error: "Too many password reset attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": "900" } },
    );
  }

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { email } = dataOrResp;

  // The demo account is shared and its password is published on the sign-in
  // page, so a reset would lock every future visitor out of the demo — the
  // whole point of which is that it always works. Answered with the same
  // opaque 200 as an unknown address, because a distinguishable response here
  // would leak which address is the demo before the page tells you.
  //
  // This lives in the handler, not in the demo route policy: /api/auth/* is
  // excluded from the proxy matcher (it has to answer before a session
  // exists), so the middleware gate never sees this path.
  if (isDemoEmailBlocked(email)) return NextResponse.json({ ok: true });

  // Always return 200 — don't reveal whether the email exists.
  const user = await getUserByEmail(email);
  if (!user) return NextResponse.json({ ok: true });

  // Never for an account only OrangeCat created: its address is unverified.
  // Same answer, so the response still says nothing (lib/auth/reset-eligibility).
  const linked = await db
    .select({ provider: accounts.provider })
    .from(accounts)
    .where(eq(accounts.userId, user.id));
  if (
    !lokiMayReceivePasswordReset(
      user,
      linked.map((a) => a.provider),
    )
  ) {
    return NextResponse.json({ ok: true });
  }

  // OAuth-created accounts do not initially have a password hash. Sending a
  // reset link to their stored email lets the account owner establish email
  // sign-in without creating a duplicate user row.
  const token = await createPasswordReset(user.id);
  const resetUrl = `${appUrl()}/reset-password/${token}`;

  try {
    const { subject, html, text } = resetPasswordEmailTemplate(resetUrl);
    await sendEmail(email, subject, html, text);
  } catch (err) {
    console.error("[forgot-password] email error:", err);
    // Don't expose email errors to the client
  }

  return NextResponse.json({ ok: true });
}
