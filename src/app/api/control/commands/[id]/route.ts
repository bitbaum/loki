import { NextRequest, NextResponse } from "next/server";
import { getCommandById, markCommandExecuted } from "@/db/queries/pending-commands";
import {
  closeRunUndelivered,
  getOrchestrationRunById,
  stampRunDelivered,
  stampRunInjectAck,
} from "@/db/queries/orchestration-runs";
import { emitRunEvent } from "@/db/queries/run-events";
import { getApiUserId } from "@/lib/session";
import { deriveDispatchLiveStatus, type CommandLiveInput } from "@/lib/dispatch-status";

// GET /api/control/commands/:id — live dispatch status the transcript footer
// polls so a dispatch shows queued → picked up → ran/failed instead of a frozen
// "starting shortly". Scoped to the owner; returns a settled `terminal` flag so
// the client can stop polling.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const command = await getCommandById(id);
  if (!command || command.userId !== userId) {
    return NextResponse.json({ error: "Command not found" }, { status: 404 });
  }
  const runId = (command.payload as { runId?: unknown } | null)?.runId;
  const run =
    typeof runId === "string"
      ? await getOrchestrationRunById(userId, runId).catch(() => null)
      : null;
  const view = deriveDispatchLiveStatus({
    claimedAt: command.claimedAt,
    executedAt: command.executedAt,
    result: (command.result ?? null) as CommandLiveInput["result"],
    run: run
      ? {
          state: run.state,
          outcome: run.outcome,
          payload: run.payload ? { error: run.payload.error } : null,
        }
      : null,
  });
  return NextResponse.json(view);
}

// Runner calls this to mark a command as executed.
// PATCH /api/control/commands/:id  body: { ok: boolean, error?: string }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ok = typeof body.ok === "boolean" ? body.ok : true;
  const error = typeof body.error === "string" ? body.error : undefined;
  const text = typeof body.text === "string" ? body.text : undefined;
  // warning/verified previously fell on the floor here — the runner's honest
  // "injected, but the agent isn't generating" never reached the DB or UI.
  const warning = typeof body.warning === "string" ? body.warning : undefined;
  const verified = typeof body.verified === "boolean" ? body.verified : undefined;
  // Stage 2 (workspace addressing): which workspace served this command.
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : undefined;
  // The runner's own injection time. It acks only after checking the agent is
  // generating (up to 8s), so ack time is too late a floor for fast tasks.
  const deliveredAt = typeof body.deliveredAt === "string" ? body.deliveredAt : undefined;

  const updated = await markCommandExecuted(id, userId, {
    ok,
    text,
    error,
    warning,
    verified,
    workspaceId,
  });
  if (!updated) return NextResponse.json({ error: "Command not found" }, { status: 404 });

  // Run ledger: project the runner's ack onto the dispatch's run. A clean ack
  // = the prompt verifiably submitted; a warning = the agent is blocked
  // (boot dialog, dead credentials, not generating) — visible as an event
  // instead of buried in a result column nobody queries.
  try {
    const command = await getCommandById(id);
    const runId = (command?.payload as { runId?: string } | null)?.runId;
    if (runId) {
      if (!ok) {
        void emitRunEvent(runId, userId, "blocked", {
          reason: error ?? "runner error",
          workspaceId,
        });
        // The prompt never landed — the run can't produce a handoff. Close it
        // now so it doesn't head-of-line block the project's queued dispatches.
        await closeRunUndelivered(runId, userId, error ?? "runner error").catch(() => {});
      } else {
        // verified:true = post-prompt generation confirmed → generating hop.
        // verified:false / warning = inject-no-generate → blocked (Needs you).
        // No verdict → submitted only (Starting until progress proves life).
        if (verified === false || warning) {
          void emitRunEvent(runId, userId, "blocked", {
            reason: warning ?? "inject-no-generate",
            workspaceId,
          });
        } else if (verified === true) {
          void emitRunEvent(runId, userId, "generating", { text, workspaceId });
        } else {
          void emitRunEvent(runId, userId, "submitted", { text, workspaceId });
        }
        // Delivery stamp: the close paths use payload.deliveredAt as the
        // handoff-freshness floor for per-run attribution.
        await stampRunDelivered(runId, userId, deliveredAt).catch(() => {});
        // One alive-bit input for Feedback: stamp inject ack onto the run so
        // work-phase does not wait on a separate command join.
        if (typeof verified === "boolean") {
          await stampRunInjectAck(runId, userId, verified, warning ?? null).catch(() => {});
        }
      }
    }
  } catch {
    /* telemetry only — never fail the ack */
  }

  return NextResponse.json({ ok: true });
}
