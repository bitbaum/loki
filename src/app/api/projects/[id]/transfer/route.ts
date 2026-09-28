import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { transferProjectOwnership, type TransferRefusal } from "@/db/queries/project-access";
import { jsonError, jsonOk, readIdParam, readJsonBody, z } from "@/lib/api/route-helpers";

const Body = z.object({ userId: z.string().uuid() });

const REFUSALS: Record<TransferRefusal, { status: number; message: string }> = {
  not_owner: { status: 403, message: "Only the owner can hand a project over" },
  not_a_member: { status: 400, message: "Add them to the project first, then hand it over" },
  same_person: { status: 400, message: "You already own this project" },
};

/**
 * Hand the project to one of its members. Owner-only; the owner keeps a
 * builder's seat. The studio's hand-over to a client is this call.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const id = await readIdParam(params);
  if (id instanceof NextResponse) return id;
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  const result = await transferProjectOwnership(id, userId, body.userId);
  if (!result.ok) {
    const r = REFUSALS[result.refusal];
    return jsonError(r.message, r.status);
  }
  return jsonOk({ transferred: true, ownerUserId: body.userId });
}
