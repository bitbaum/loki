import {
  ORCHESTRATION_TASK_SUMMARY_FIELDS,
  type OrchestrationTaskSummary,
  type OrchestrationTaskSummaryField,
} from "@/lib/orchestration/contract";

/**
 * Build a complete OrchestrationTaskSummary from a partial field map, defaulting
 * every missing field to "". Generated from ORCHESTRATION_TASK_SUMMARY_FIELDS so
 * adding a field to that SSOT array automatically persists it everywhere — no
 * hand-written object literal can silently drop a field again (the bug that left
 * `block-reason`/`no-op-count` unsaved despite being in the contract).
 */
export function buildOrchestrationSummary(
  fields: Partial<Record<OrchestrationTaskSummaryField, string | undefined>>,
): OrchestrationTaskSummary {
  // Object.fromEntries infers a string-record; the summary also has the optional
  // structured `verification` field (absent here — set only by the DoD gate at
  // close), so cast through unknown. Every required text field is present via the
  // SSOT field list above.
  return Object.fromEntries(
    ORCHESTRATION_TASK_SUMMARY_FIELDS.map((field) => [field, fields[field] ?? ""]),
  ) as unknown as OrchestrationTaskSummary;
}

export function parseOrchestrationSummary(
  text: string | undefined,
): OrchestrationTaskSummary | undefined {
  if (!text) return undefined;

  const fields: Partial<Record<OrchestrationTaskSummaryField, string>> = {};
  const fieldNames = ORCHESTRATION_TASK_SUMMARY_FIELDS.join("|");
  const fieldPattern = new RegExp(`^(${fieldNames}):\\s*(.*)$`, "i");

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(fieldPattern);
    if (!match) continue;

    const key = match[1].toLowerCase() as OrchestrationTaskSummaryField;
    fields[key] = match[2].trim();
  }

  if (!ORCHESTRATION_TASK_SUMMARY_FIELDS.some((field) => fields[field])) return undefined;

  return buildOrchestrationSummary(fields);
}

/**
 * What the agent itself said it did, for a human reading a closed run.
 *
 * `payload.resultText` is written by the runners that report a result back
 * directly (the hosted runner, openclaw). The local PTY path has none: it
 * closes from the agent's session handoff, and the agent's words land in
 * `summary` instead. Both close notifications used to read only resultText,
 * so every locally-closed run — the main path, the one a person watches after
 * typing into /loki — arrived as a bare "🟡 partly done" with nothing said
 * about what happened. That is precisely the trip out of the product these
 * messages exist to prevent.
 *
 * `next` is carried as well as `done`, because on anything short of success it
 * holds the reason: the definition-of-done judge writes the gap it found
 * there, and the gap is the one thing the operator has to act on.
 */
export function runReportText(run: {
  payload?: { resultText?: string; error?: string } | null;
  summary?: OrchestrationTaskSummary | null;
}): string {
  const direct = run.payload?.resultText?.trim() || run.payload?.error?.trim() || "";
  if (direct) return direct;

  const done = run.summary?.done?.trim() ?? "";
  const next = run.summary?.next?.trim() ?? "";
  const lines: string[] = [];
  if (done) lines.push(done);
  if (next && next.toLowerCase() !== "none") lines.push(`Next: ${next}`);
  return lines.join("\n\n");
}

/** The `project_states` handoff columns, named as the summary's own fields. */
export type SessionHandoffRow = {
  status: string | null;
  tsc: string | null;
  lint: string | null;
  tests: string | null;
  todos: string | null;
  done: string | null;
  next: string | null;
  commit: string | null;
  health: string | null;
  blockReason: string | null;
  noOpCount: number | null;
  /** GREATEST(ready_at, session_updated_at) — the reaper's own recency basis. */
  writtenAtMs: number;
};

/**
 * Build a run summary from a saved session handoff, or null when that handoff
 * cannot honestly be attributed to the run.
 *
 * The third "summary from X" builder, beside the field map and the text parse.
 * Used by the post-reap pass that gives a reaped `partial` its handoff back —
 * the reaper stamps that outcome on proof a handoff EXISTS and then copied none
 * of it, leaving a verdict with nothing behind it.
 *
 * Pure so it is testable without a database; the DB half lives in reap-handoff.ts.
 */
export function summaryFromHandoff(
  row: SessionHandoffRow,
  effectiveStartMs: number,
): OrchestrationTaskSummary | null {
  // Same floor as `closeRunFromSession` and the reaper's `wroteAfterStart`: a
  // handoff from before this run's prompt was delivered is someone else's work.
  if (!(row.writtenAtMs > effectiveStartMs)) return null;

  const summary = buildOrchestrationSummary({
    status: row.status ?? undefined,
    tsc: row.tsc ?? undefined,
    lint: row.lint ?? undefined,
    tests: row.tests ?? undefined,
    todos: row.todos ?? undefined,
    done: row.done ?? undefined,
    next: row.next ?? undefined,
    commit: row.commit ?? undefined,
    health: row.health ?? undefined,
    "block-reason": row.blockReason ?? undefined,
    "no-op-count": row.noOpCount != null ? String(row.noOpCount) : undefined,
  });

  // An all-blank summary is the NULL we started with, dressed up — it would
  // read as the agent deliberately reporting nothing. Leave the column NULL.
  const hasContent = Object.values(summary).some((v) => typeof v === "string" && v.trim() !== "");
  return hasContent ? summary : null;
}
