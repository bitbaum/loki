import { type NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { readIdParam, readJsonBody, z } from "@/lib/api/route-helpers";
import {
  getConversationWithMessages,
  deleteConversation,
  markConversationRead,
  setConversationPinned,
  updateConversationTitle,
} from "@/db/queries/conversations";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const result = await getConversationWithMessages(userId, idOrResp);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(result);
}

const PatchBody = z
  .object({
    /** The person has the thread open: mark everything so far as read. */
    read: z.literal(true).optional(),
    pinned: z.boolean().optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((b) => b.read !== undefined || b.pinned !== undefined || b.title !== undefined, {
    message: "nothing to change",
  });

/**
 * PATCH /api/conversations/[id] — the small facts the rail keeps per thread:
 * read, pinned, renamed. Each is independent and each is the person's own
 * act, so none of them bumps updatedAt (the rail's recency order is about
 * the conversation, not about looking at it).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const dataOrResp = await readJsonBody(req, PatchBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const readAt = new Date();
  if (dataOrResp.read) {
    const ok = await markConversationRead(userId, idOrResp, readAt);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (dataOrResp.pinned !== undefined) {
    const row = await setConversationPinned(userId, idOrResp, dataOrResp.pinned);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (dataOrResp.title !== undefined) {
    const row = await updateConversationTitle(userId, idOrResp, dataOrResp.title, {
      touch: false,
    });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, readAt: dataOrResp.read ? readAt.toISOString() : null });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const deleted = await deleteConversation(userId, idOrResp);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
