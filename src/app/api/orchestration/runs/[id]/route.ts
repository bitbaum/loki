import { NextResponse } from "next/server";
import { getOrchestrationRunById } from "@/db/queries/orchestration-runs";
import { deriveDispatchLiveStatus } from "@/lib/dispatch-status";
import { getApiUserId } from "@/lib/session";
import { runHandoff } from "@/lib/run-handoff";
import { loadRunTrack } from "@/lib/run-track-load";

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
  // Where the change is — the same track Watch draws, so the chat card and
  // the Watch page tell one story (lib/run-track-load).
  const loaded = await loadRunTrack(userId, run).catch(() => null);
  return NextResponse.json(
    {
      ...view,
      handoff: runHandoff(run.finishedAt ? run.summary : null),
      follow: view.terminal ? (loaded?.follow ?? null) : null,
      track: loaded?.track ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
