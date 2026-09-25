// Definition-of-done stop-gate — the /goal pattern for autopilot.
//
// The agent writes its own handoff (status: ready), so "done" is the agent
// grading its own homework — the Ralph Wiggum failure mode. When a project
// declares a definition_of_done, we don't take the agent's word for it: the
// handoff is checked against the stated bar (evidence-precheck.ts) and, if it
// doesn't hold, the run closes "partial" with the gap as the next instruction,
// and autopilot's existing continue-loop keeps going.
//
// There used to be a cross-model judge here (gpt-oss on Groq) for what the
// precheck could not decide. It was removed on 2026-09-25: it ran on every run
// close — a page poll, a runner push, a cron sweep — which is never a person
// asking, and it spent the free tier every app on the box shares.

import { ESCALATION_HUMAN_STREAK } from "./escalation-ladder";
import type { RunClosePatch } from "./close-from-session";
import type { OrchestrationTaskSummary } from "./contract";

/**
 * The goal loop's default bound, used when a project sets no `goal_max_turns`.
 *
 * It used to be "no cap = loop until met", and NO project had ever set the
 * attribute — so every goal-mode project looped forever. That is worse than it
 * sounds: because `partial` is not a failing outcome, an endless partial streak
 * is invisible to BOTH the failure brake and the escalation ladder. datacat
 * re-closed `partial` a dozen times against the same gap ("client-side Zod
 * validation still missing") and nothing ever told a human. An unbounded goal
 * loop is indistinguishable from a stuck one, so the bound must be the default
 * rather than the opt-in.
 *
 * SSOT'd to the escalation ladder's top rung: the same number of tries
 * autopilot gets anywhere else before a human is brought in.
 */
export const DEFAULT_GOAL_MAX_TURNS = ESCALATION_HUMAN_STREAK;

export type DoDVerdict = { met: boolean; gap: string };

/**
 * The fields the judge is shown — i.e. everything that can count as evidence.
 * Exported because it is the SSOT for "what the grader can possibly see", and
 * every layer between the agent and here must carry all of it.
 *
 * That is not a theoretical requirement. `tsc`, `lint` and `commit` sat in this
 * list (and in the worker's contract) while NO layer in between carried them:
 * no column on `project_states`, no field on `SessionState`, not passed by
 * `closeRunFromSession`, not sent by the desktop pusher. Across 56 runs with a
 * summary, `tests` was filled 55 times and these three exactly ZERO — the
 * judge was asked to check evidence it could never be shown, so it correctly
 * answered "not met" and downgraded good work to `partial`.
 *
 * `scripts/test/handoff-evidence.ts` walks this list and fails if a field
 * cannot survive the trip from handoff to judge. Add a field here and the test
 * tells you every layer you still owe.
 */
export const DOD_EVIDENCE_FIELDS: Array<[keyof OrchestrationTaskSummary, string]> = [
  ["done", "What the agent says it did"],
  ["tests", "Tests"],
  ["tsc", "Typecheck"],
  ["lint", "Lint"],
  // The resulting HEAD sha (or "none"). DoDs routinely say "committed"/"shipped",
  // so the judge must SEE whether the agent actually committed — without this it
  // false-negatives a fully-evidenced handoff for "no commit evidence".
  ["commit", "Commit (resulting HEAD sha, or 'none' if no commit)"],
  ["health", "Health"],
  ["next", "Agent's stated next step"],
];

export function summaryForJudge(s: OrchestrationTaskSummary): string {
  return DOD_EVIDENCE_FIELDS.map(([k, label]) => [
    label,
    (s as Record<string, unknown>)[k as string],
  ])
    .filter(([, v]) => typeof v === "string" && (v as string).trim())
    .map(([label, v]) => `${label}: ${v}`)
    .join("\n");
}

/**
 * Apply the DoD verdict to a close patch. Pure + testable.
 * Only gates a SUCCESS close: a run the agent already reported as error/partial
 * keeps its outcome. When the bar isn't met, downgrade success → partial and
 * write the gap into `next` so autopilot's continue-loop picks it up as the
 * next instruction ("don't stop until the bar holds").
 *
 * Turn cap (goal-mode): `opts.maxTurns` bounds how many times the gate will
 * re-loop a goal. `opts.priorPartials` is how many times it has ALREADY looped
 * (consecutive partial closes). Once that reaches the cap, the gate STOPS
 * downgrading — the run keeps its success outcome, so there is no gap for the
 * continue-loop to pick up and it halts. The cap is thus enforced entirely here,
 * without touching the loop. `next` records that the goal was capped, so the
 * captain sees it stopped short rather than silently. No cap (maxTurns null) =
 * unchanged behavior: loop until met.
 */
export function applyDoDGate(
  patch: RunClosePatch,
  verdict: DoDVerdict,
  opts: { priorPartials?: number; maxTurns?: number | null } = {},
): RunClosePatch {
  if (patch.outcome !== "success" || verdict.met) return patch;

  const { maxTurns, priorPartials = 0 } = opts;
  if (maxTurns != null && priorPartials >= maxTurns) {
    // Cap reached — stop looping. Keep success (no gap → loop ends), but flag it.
    return {
      ...patch,
      summary: {
        ...patch.summary,
        next: `Goal not met after ${maxTurns} attempt(s) — stopping and escalating to the captain. Last gap: ${verdict.gap || "the stated bar is not evidenced in the handoff"}.`,
      },
    };
  }

  return {
    ...patch,
    outcome: "partial",
    summary: {
      ...patch.summary,
      next: `Definition of done not yet met — ${verdict.gap || "the stated bar is not evidenced in the handoff"}. Address this, then re-verify.`,
    },
  };
}
