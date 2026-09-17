import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getUserByEmail } from "@/db/queries/users";
import {
  getProjectAccess,
  listProjectMembers,
  removeProjectMember,
  upsertProjectMember,
} from "@/db/queries/project-access";
import { jsonError, jsonOk, readIdParam, readJsonBody, z } from "@/lib/api/route-helpers";
import { PROJECT_ROLE_VALUES } from "@/db/schema";

const AddBody = z.object({
  email: z.string().email().max(320),
  role: z.enum(PROJECT_ROLE_VALUES).default("editor"),
});
const DeleteBody = z.object({ userId: z.string().uuid() });

async function ownerAccess(params: Promise<{ id: string }>) {
  const userId = await getSessionUserId();
  if (!userId) return { error: jsonError("Unauthorized", 401) } as const;
  const id = await readIdParam(params);
  if (id instanceof NextResponse) return { error: id } as const;
  const access = await getProjectAccess(userId, id);
  if (!access) return { error: jsonError("Project not found", 404) } as const;
  return { id, access } as const;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await ownerAccess(params);
  if ("error" in result) return result.error;
  return jsonOk({
    members: await listProjectMembers(result.id),
    canManage: result.access.canManageMembers,
    role: result.access.role,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await ownerAccess(params);
  if ("error" in result) return result.error;
  if (!result.access.canManageMembers)
    return jsonError("Only the project owner can manage editors", 403);
  const body = await readJsonBody(req, AddBody);
  if (body instanceof NextResponse) return body;
  const user = await getUserByEmail(body.email);
  if (!user) return jsonError("No Loki account uses that email. Ask them to register first.", 404);
  if (user.id === result.access.ownerUserId)
    return jsonError("The project owner already has full access", 409);
  return jsonOk({ member: await upsertProjectMember(result.id, user.id, body.role) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await ownerAccess(params);
  if ("error" in result) return result.error;
  if (!result.access.canManageMembers)
    return jsonError("Only the project owner can manage editors", 403);
  const body = await readJsonBody(req, DeleteBody);
  if (body instanceof NextResponse) return body;
  return jsonOk({ removed: await removeProjectMember(result.id, body.userId) });
}
