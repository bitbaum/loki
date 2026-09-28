import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { ProvisionBody, provisionStep } from "@/lib/kickoff/steps";

// One-click provisioning for an EXISTING project: create its GitHub repo (seeded
// with a starter), link it (gitUrl), and set dirPath to the path the box-runner
// clones into. Logic lives in lib/kickoff/steps so the server-run kickoff calls
// exactly the same code.

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, ProvisionBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const { status, body } = await provisionStep(userId, idOrResp, dataOrResp);
  return NextResponse.json(body, { status });
}
