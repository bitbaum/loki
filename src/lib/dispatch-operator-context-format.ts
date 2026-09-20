/**
 * Pure formatting for the operator dispatch-context block. DB-free on purpose —
 * the async assembler (dispatch-operator-context.ts) imports @/db/queries and so
 * can't host a DB-free self-test; the layout logic lives here where it can.
 */
import { isOverdue, toLocalDateStr } from "@/lib/dates";

/** Section heading — SSOT for how the operator block is framed at every dispatch
 *  site. Mirrors the "background, not instructions" framing of the fleet-RAG block
 *  so a well-aligned agent never mistakes it for a task. */
export const OPERATOR_CONTEXT_HEADING =
  "## The operator's goals & deadlines (background — align your priorities)";

export type OperatorGoalRow = { title: string; progress: number | null; targetDate: Date | null };
export type OperatorCommitmentRow = { description: string; dueDate: Date | null };

/** Pure formatter — no I/O, so the layout is unit-testable. Empty string when
 *  there is nothing to say (caller omits the section entirely).
 *
 *  `now` is injectable because every date here is rendered RELATIVE to it: a
 *  date is either still ahead of the operator or already missed, and which one
 *  it is changes the word in front of it. Tests set it rather than freezing
 *  the clock.
 *
 *  Why the word matters. Dispatches on 2026-09-20 carried "The operator's
 *  near-term commitments/deadlines (be mindful of these): - Get a $50 signup
 *  bonus ... - due 2026-05-03" — a window that had closed four and a half
 *  months earlier, handed to every agent as something to aim at. An expired
 *  date under a heading that says "near-term" is not context, it is a false
 *  premise, and the surrounding prompt tells the agent to prioritise by it.
 *  Overdue rows still belong here — a commitment someone missed is exactly
 *  what an agent should know about — they just have to arrive LABELLED as
 *  missed, so it can weigh "this slipped" instead of reading it as "this is
 *  coming up". */
export function formatOperatorContextBlock(
  goals: OperatorGoalRow[],
  commitments: OperatorCommitmentRow[],
  now: Date = new Date(),
): string {
  if (goals.length === 0 && commitments.length === 0) return "";
  const lines: string[] = [];
  if (goals.length > 0) {
    lines.push("The operator's current top-level goals (aim your work to serve these):");
    for (const g of goals) {
      const progress = typeof g.progress === "number" ? ` (${g.progress}%)` : "";
      const target = g.targetDate
        ? ` — target ${toLocalDateStr(g.targetDate)}${isOverdue(g.targetDate, now) ? " (PAST, not met)" : ""}`
        : "";
      lines.push(`- ${g.title}${progress}${target}`);
    }
  }
  if (commitments.length > 0) {
    if (lines.length > 0) lines.push("");
    // Not "near-term": the list deliberately carries overdue rows too, and a
    // heading that calls them near-term contradicts the label on the row.
    lines.push("The operator's commitments/deadlines (be mindful of these):");
    for (const c of commitments) {
      const due = c.dueDate
        ? isOverdue(c.dueDate, now)
          ? ` — was due ${toLocalDateStr(c.dueDate)} (OVERDUE)`
          : ` — due ${toLocalDateStr(c.dueDate)}`
        : "";
      lines.push(`- ${c.description}${due}`);
    }
  }
  return lines.join("\n");
}
