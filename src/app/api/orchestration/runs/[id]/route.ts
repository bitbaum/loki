import { NextResponse } from "next/server";
import { getOrchestrationRunById } from "@/db/queries/orchestration-runs";
import { deriveDispatchLiveStatus } from "@/lib/dispatch-status";
import { getApiUserId } from "@/lib/session";
import { runHandoff } from "@/lib/run-handoff";
import { followRun } from "@/lib/run-follow";
import { loadRunMilestones } from "@/lib/run-milestones-load";

// GET /api/orchestration/runs/:id - live status for direct Loki dispatches.
// The run query is user-scoped so a guessed UUID cannot expose another
// operator's execution state.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const run = await getOrchestrationRunById(userId, id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const view = deriveDispatchLiveStatus({
    claimedAt: null,
    executedAt: run.startedAt,
    result: { ok: true, verified: true },
    run: {
      state: run.state,
      outcome: run.outcome,
      payload: run.payload ? { error: run.payload.error } : null,
    },
  });
  return NextResponse.json(
    {
      ...view,
      handoff: runHandoff(run.finishedAt ? run.summary : null),
      follow: view.terminal ? await followRun(userId, run).catch(() => null) : null,
      milestones: await loadRunMilestones(userId, run, run.startedAt).catch(() => null),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
