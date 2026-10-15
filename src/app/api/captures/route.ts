import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/session";
import { createCapture, listCaptures } from "@/db/queries/captures";
import { readJsonBody } from "@/lib/api/route-helpers";

const CreateCaptureBody = z.object({
  body: z.string().min(1).max(10000),
});

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const items = await listCaptures(userId, 20);
  return NextResponse.json({ captures: items });
}

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dataOrResp = await readJsonBody(req, CreateCaptureBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const capture = await createCapture(userId, dataOrResp.body);
  return NextResponse.json({ ok: true, capture }, { status: 201 });
}
