import { NextResponse } from "next/server";
import { getOrchestrationRunById } from "@/db/queries/orchestration-runs";
import {
  alignLiveViewWithTrack,
  deriveDispatchLiveStatus,
  type CommandLiveInput,
} from "@/lib/dispatch-status";
import { getCommandById } from "@/db/queries/pending-commands";
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

  // A run that went through the queue is judged by its own command row. This
  // route used to answer for every run as if its prompt had been executed and
  // verified the moment the run was opened, so a run still waiting for a
  // runner read "Delivered to agent". Only a run with no command (typed
  // straight into a live session on this runtime) starts as executed.
  const commandId = (run.payload as { commandId?: unknown } | null)?.commandId;
  const command =
    typeof commandId === "string" ? await getCommandById(commandId).catch(() => null) : null;
  const queued = command && command.userId === userId ? command : null;
  const view = deriveDispatchLiveStatus({
    claimedAt: queued ? queued.claimedAt : null,
    executedAt: queued ? queued.executedAt : run.startedAt,
    result: queued
      ? ((queued.result ?? null) as CommandLiveInput["result"])
      : { ok: true, verified: true },
    run: {
      state: run.state,
      outcome: run.outcome,
      payload: run.payload ? { error: run.payload.error } : null,
    },
  });
  // Where the change is — the same track Watch draws, so the chat card and
  // the Watch page tell one story (lib/run-track-load).
  // What the command row knows and no run event says: a runner's claim; or,
  // for a prompt typed straight into a live session, that it was submitted.
  const deliveredAt = (run.payload as { deliveredAt?: unknown } | null)?.deliveredAt;
  const loaded = await loadRunTrack(userId, run, {
    known: queued
      ? { claimed: queued.claimedAt }
      : { submitted: typeof deliveredAt === "string" ? deliveredAt : run.startedAt },
  }).catch(() => null);
  return NextResponse.json(
    {
      // One status: while the run is open, the word is the track's.
      ...alignLiveViewWithTrack(
        view,
        loaded?.track,
        queued
          ? { claimed: Boolean(queued.claimedAt), executed: Boolean(queued.executedAt) }
          : null,
      ),
      handoff: runHandoff(run.finishedAt ? run.summary : null),
      follow: view.terminal ? (loaded?.follow ?? null) : null,
      track: loaded?.track ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
