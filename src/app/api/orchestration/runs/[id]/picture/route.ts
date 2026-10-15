import { NextResponse } from "next/server";
import { getOrchestrationRunById } from "@/db/queries/orchestration-runs";
import { getApiUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;

/**
 * The picture Loki took of the live page when it checked a chat build's change
 * (feedback/verify-live.ts keeps it on the run as payload.fixPicture). The
 * chat card shows it under "Live", so the owner sees the result without
 * leaving the conversation. Owner-scoped like the run itself.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  const run = await getOrchestrationRunById(userId, id).catch(() => null);
  const m = run?.payload?.fixPicture?.match(DATA_URL);
  if (!m) return NextResponse.json({ error: "No picture" }, { status: 404 });
  return new NextResponse(Buffer.from(m[2], "base64"), {
    headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=3600" },
  });
}
