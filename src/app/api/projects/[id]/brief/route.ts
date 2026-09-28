import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { BriefBody, briefStep } from "@/lib/kickoff/steps";

// Free-form project brief → structured profile. The user writes (or dictates)
// what the project should be in plain language; the model fills description +
// mission/vision/customers/stack/status/next_step. No forms. Logic lives in
// lib/kickoff/steps so the server-run kickoff calls exactly the same code.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, BriefBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const { status, body } = await briefStep(userId, idOrResp, dataOrResp);
  return NextResponse.json(body, { status });
}
