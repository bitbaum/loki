import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/session";
import { readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { getProjectCore } from "@/db/queries/projects";
import { getProjectOrchestrationRuns } from "@/db/queries/orchestration-runs";
import { retryProjectRun } from "@/lib/project-retry";

/**
 * POST /api/projects/[id]/watch/retry — the Watch page's one tap.
 * Re-sends the latest run's request; with `agent`, on that provider (and
 * remembers it), without, on the next provider that can answer.
 */
const Body = z.object({ agent: z.string().max(40).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [run] = await getProjectOrchestrationRuns(userId, idOrResp, 1);
  if (!run) return NextResponse.json({ error: "Nothing to retry yet." }, { status: 409 });

  const result = await retryProjectRun(userId, run.id, { agent: dataOrResp.agent });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
