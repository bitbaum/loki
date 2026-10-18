import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { movePreview } from "@/lib/previews/move";
import { getApiUserId } from "@/lib/session";

const Body = z.object({
  to: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120).optional(),
});

/**
 * POST /api/previews/<slug>/move — give a preview a new address (and name).
 * Owner only. Logic and order: lib/previews/move.ts.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Sign in to move your preview.", 401);
  const body = await readJsonBody(req, Body);
  if (body instanceof NextResponse) return body;
  const { slug } = await params;
  const moved = await movePreview(userId, slug, body);
  if (!moved.ok) return jsonError(moved.error, moved.status);
  return jsonOk(moved);
}
