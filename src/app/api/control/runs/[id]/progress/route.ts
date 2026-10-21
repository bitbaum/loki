import { NextResponse, type NextRequest } from "next/server";
import { getApiUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";
import { stampRunProgress } from "@/db/queries/orchestration-runs";
import { emitRunEvent } from "@/db/queries/run-events";
import { RUN_BLOCKED, RUN_QUESTION_MAX_CHARS, RUN_STEP_MAX_CHARS } from "@/lib/run-progress";

/**
 * Runner heartbeat for a dispatched run — PATCH /api/control/runs/:id/progress
 * body: { outputBytes: number, lastOutputAt: ISO }. Bearer runner token, like
 * the command ack. Answers { ok, live } — live:false once the run is closed,
 * which tells the runner to stop beating. Contract: src/lib/run-progress.ts.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as {
    outputBytes?: unknown;
    lastOutputAt?: unknown;
    blocked?: unknown;
    step?: unknown;
    question?: unknown;
  };
  const outputBytes =
    typeof body.outputBytes === "number" && Number.isFinite(body.outputBytes)
      ? Math.max(0, Math.min(Math.round(body.outputBytes), 1_000_000_000))
      : 0;
  const lastOutputAt =
    typeof body.lastOutputAt === "string" && !Number.isNaN(Date.parse(body.lastOutputAt))
      ? body.lastOutputAt
      : null;
  // The runner can name why a quiet agent is quiet. "Waiting for a sign-in" is
  // the operator's problem RIGHT NOW; "thinking" is nobody's. Before this, both
  // looked identical from here and the row could only report the silence.
  const blocked =
    body.blocked === RUN_BLOCKED.AUTH ||
    body.blocked === RUN_BLOCKED.PERMISSION ||
    body.blocked === RUN_BLOCKED.EXITED
      ? body.blocked
      : null;
  // The agent's own question at a tool-approval prompt — shown as text only.
  const question =
    (blocked === RUN_BLOCKED.PERMISSION || blocked === RUN_BLOCKED.EXITED) &&
    typeof body.question === "string"
      ? body.question
          .replace(/[\u0000-\u001f\u007f]+/g, " ")
          .trim()
          .slice(0, RUN_QUESTION_MAX_CHARS) || null
      : null;
  // What the agent is doing now, read by the runner from the session log. It
  // is the agent's own words, so it is shown as text and never as markup.
  const step =
    typeof body.step === "string"
      ? body.step
          .replace(/[\u0000-\u001f\u007f]+/g, " ")
          .trim()
          .slice(0, RUN_STEP_MAX_CHARS) || null
      : null;

  const live = await stampRunProgress(id, userId, blocked, step, question);
  if (live) {
    void emitRunEvent(id, userId, "progress", { outputBytes, lastOutputAt });
    // Once per stretch of being blocked, not once per beat: the runner clears
    // the flag as soon as the agent prints, so a new event means a new block.
    if (blocked)
      void emitRunEvent(id, userId, "blocked", {
        reason:
          blocked === RUN_BLOCKED.AUTH
            ? "agent is not signed in"
            : blocked === RUN_BLOCKED.EXITED
              ? `agent stopped: ${question ?? "its process ended"}`
              : `agent is asking: ${question ?? "permission to run a tool"}`,
      });
  }
  return NextResponse.json({ ok: true, live });
}
