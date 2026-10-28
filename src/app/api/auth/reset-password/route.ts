import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getPasswordReset, consumePasswordReset } from "@/db/queries/passwordResets";
import { hashPassword } from "@/lib/password";
import { updateUserPasswordHash } from "@/db/queries/users";
import { isDemoUserId } from "@/lib/demo-guard";
import { passwordSchema } from "@/lib/password-schema";

const Body = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export async function POST(req: NextRequest) {
  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { token, password } = dataOrResp;

  const reset = await getPasswordReset(token);
  if (!reset) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired." },
      { status: 400 },
    );
  }

  // Defense in depth: forgot-password never mints a token for the demo
  // account, so reaching here with one means that guard was bypassed or a token
  // predates the demo. Refuse either way — the demo password is published and
  // must keep working for the next visitor.
  if (await isDemoUserId(reset.userId)) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired." },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(password);

  const consumed = await consumePasswordReset(token);
  if (!consumed) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired." },
      { status: 400 },
    );
  }

  await updateUserPasswordHash(reset.userId, passwordHash);

  return NextResponse.json({ ok: true });
}
