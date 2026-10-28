import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getUserByEmail, createUser } from "@/db/queries/users";
import { createEmailVerificationToken } from "@/db/queries/emailVerification";
import { hashPassword } from "@/lib/password";
import { sendEmailFire, verifyEmailTemplate, welcomeEmailTemplate, appUrl } from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { passwordSchema } from "@/lib/password-schema";

const Body = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  email: z.string().trim().email("Invalid email address.").toLowerCase(),
  password: passwordSchema,
});

const LIMIT = 10; // max registrations
const WINDOW = RATE_LIMIT_WINDOW_LONG_MS;

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`register:${getClientIp(req)}`, LIMIT, WINDOW)) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { name, email, password } = dataOrResp;

  const existing = await getUserByEmail(email);
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({ name, email, passwordHash });

  // Send verification + welcome emails (fire-and-forget — don't block registration)
  try {
    const token = await createEmailVerificationToken(user.id);
    const verifyUrl = `${appUrl()}/verify-email/${token}`;
    const { subject, html, text } = verifyEmailTemplate(verifyUrl, name);
    sendEmailFire(email, subject, html, text);
  } catch (err) {
    console.error("[register] failed to create verification token:", err);
  }

  try {
    const { subject, html, text } = welcomeEmailTemplate(name);
    sendEmailFire(email, subject, html, text);
  } catch (err) {
    console.error("[register] failed to send welcome email:", err);
  }

  return NextResponse.json({ ok: true, userId: user.id }, { status: 201 });
}
