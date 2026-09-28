import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { DispatchBody, dispatchStep } from "@/lib/kickoff/steps";

// One-click dispatch of a profile-called-out action through the same
// injectPrompt SSOT every other dispatch path uses. Logic lives in
// lib/kickoff/steps so the server-run kickoff calls exactly the same code.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, DispatchBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const { status, body } = await dispatchStep(userId, idOrResp, dataOrResp);
  return NextResponse.json(body, { status });
}
