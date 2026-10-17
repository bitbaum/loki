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
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // `?which=before` serves the picture taken at dispatch; the default is the
  // one Loki took after the fix went live.
  const which = new URL(req.url).searchParams.get("which") === "before" ? "before" : "after";
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  const run = await getOrchestrationRunById(userId, id).catch(() => null);
  const source = which === "before" ? run?.payload?.beforePicture : run?.payload?.fixPicture;
  const m = source?.match(DATA_URL);
  if (!m) return NextResponse.json({ error: "No picture" }, { status: 404 });
  return new NextResponse(Buffer.from(m[2], "base64"), {
    headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=3600" },
  });
}
