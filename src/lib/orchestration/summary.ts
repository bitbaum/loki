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
