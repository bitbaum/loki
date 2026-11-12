import { NextRequest, NextResponse } from "next/server";
import { getApiUserId, getSessionUserId } from "@/lib/session";
import { normalizeUsername } from "@/lib/username";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { toClientUser } from "@/lib/user-client-view";
import { getUserById, getUserByUsername, updateUser, deleteUserAccount } from "@/db/queries/users";

const PatchBody = z.object({
  username: z
    .preprocess(
      (value) => (typeof value === "string" ? normalizeUsername(value) : value),
      z
        .string()
        .min(2)
        .max(40)
        .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only"),
    )
    .optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toClientUser(user));
}

export async function PATCH(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dataOrResp = await readJsonBody(req, PatchBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { username, name } = dataOrResp;

  if (username) {
    const existing = await getUserByUsername(username);
    if (existing && existing.id !== userId) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
  }

  const updated = await updateUser(userId, {
    username,
    name,
  });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(toClientUser(updated));
}

const DeleteBody = z.object({
  // The user must type their exact email (or username) — a deliberate,
  // unambiguous confirmation for an irreversible action.
  confirm: z.string().trim().min(1).max(200),
});

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, DeleteBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const typed = dataOrResp.confirm.toLowerCase();
  const matches =
    (user.email && typed === user.email.toLowerCase()) ||
    (user.username && typed === user.username.toLowerCase());
  if (!matches) {
    return NextResponse.json(
      { error: "Confirmation does not match your email or username" },
      { status: 400 },
    );
  }

  // The platform's seeded default user is load-bearing (owns shared fixtures);
  // deleting it would brick the instance.
  if (user.isDefault) {
    return NextResponse.json({ error: "The default account cannot be deleted" }, { status: 403 });
  }

  await deleteUserAccount(userId);
  return NextResponse.json({ ok: true });
}
