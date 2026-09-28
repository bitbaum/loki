import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { RoadmapBody, roadmapStep } from "@/lib/kickoff/steps";

// Spec → build roadmap: the model decomposes a spec into ordered milestones,
// created as project goals. Logic lives in lib/kickoff/steps so the server-run
// kickoff calls exactly the same code.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, RoadmapBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const { status, body } = await roadmapStep(userId, idOrResp, dataOrResp);
  return NextResponse.json(body, { status });
}
