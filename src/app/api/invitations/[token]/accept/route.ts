import { NextRequest, NextResponse } from "next/server";
import { acceptInvitation } from "@/db/queries/invitations";
import { hashPassword } from "@/lib/password";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { passwordSchema } from "@/lib/password-schema";

const AcceptBody = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  password: passwordSchema,
  email: z.string().email().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const dataOrResp = await readJsonBody(req, AcceptBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { name, password, email } = dataOrResp;

  const passwordHash = await hashPassword(password);
  const result = await acceptInvitation(token, name, passwordHash, email);

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, userId: result.userId });
}
