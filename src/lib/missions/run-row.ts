/**
 * One row of a mission's "Recent runs", in words (missions/[id]/page.tsx).
 *
 * The list was five identical rows — "Running or queued 12.11.2026" — that
 * said neither what the run was doing, nor whether it had started, nor when
 * today, and could not be tapped to watch it; a failed one read "error"
 * (2026-11-12). The owner's question is "is anything running, and can I
 * watch it": each row now answers it, and opens the run on Watch.
 */
import { ORCH_STATE } from "@/lib/orchestration/contract";
import { getIntentLabel } from "@/config/control-intents";
import { timeAgo } from "@/lib/dates";

export type MissionRunInput = {
  id: string;
  state: string;
  outcome: string | null;
  intent: string;
  startedAt: Date;
  finishedAt: Date | null;
  summary?: { done?: string | null } | null;
  payload?: { deliveredAt?: string; lastStep?: { text: string } | null } | null;
};

export type MissionRunRow = {
  title: string;
  status: string;
  tone: "positive" | "negative" | "warning" | undefined;
  when: string;
  href: string;
};

/** How a finished run ended, the way a person says it. */
export const RUN_OUTCOME_WORDS: Record<string, string> = {
  success: "Finished",
  partial: "Finished part of it",
  error: "Stopped with a problem",
  timeout: "Ran out of time",
  hang: "Stopped answering",
  user_abort: "Stopped by you",
  unconfirmed: "Never confirmed it started",
};

function firstLine(text: string | null | undefined): string | null {
  const line = text?.trim().split(/\n/)[0]?.trim();
  if (!line) return null;
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

export function missionRunRow(run: MissionRunInput, projectId: string): MissionRunRow {
  const href = `/projects/${projectId}/watch?run=${run.id}`;
  const title =
    firstLine(run.summary?.done) ??
    firstLine(run.payload?.lastStep?.text) ??
    getIntentLabel(run.intent);
  const when = timeAgo(run.startedAt.getTime());
  if (!run.finishedAt) {
    const started =
      Boolean(run.payload?.deliveredAt) ||
      run.state === ORCH_STATE.RUNNING ||
      run.state === ORCH_STATE.CLOSING;
    return {
      title,
      status: started ? "Working now" : "Waiting to start",
      tone: started ? "positive" : undefined,
      when,
      href,
    };
  }
  const outcome = run.outcome ?? "success";
  const failed = outcome !== "success" && outcome !== "partial";
  return {
    title,
    status: RUN_OUTCOME_WORDS[outcome] ?? "Finished",
    tone: failed ? "negative" : undefined,
    when,
    href,
  };
}
