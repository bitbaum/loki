import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/password";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getUserCount, createInitialUser } from "@/db/queries/users";
import { passwordSchema } from "@/lib/password-schema";

const SetupBody = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  password: passwordSchema,
});

export async function POST(req: NextRequest) {
  // Only allowed when no users exist — prevents takeover after setup
  if ((await getUserCount()) > 0) {
    return NextResponse.json({ error: "Setup already complete." }, { status: 409 });
  }

  const dataOrResp = await readJsonBody(req, SetupBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { name, password } = dataOrResp;

  const passwordHash = await hashPassword(password);
  const user = await createInitialUser({ name, passwordHash });

  return NextResponse.json({ ok: true, userId: user.id });
}

// HEAD — lets middleware quickly check whether setup is needed
export async function GET() {
  const setupDone = (await getUserCount()) > 0;
  return NextResponse.json({ setupDone });
}
