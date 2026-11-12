/**
 * Escalation ladder — retry → patch → replan → human. Pure logic (no db).
 *
 * The ladder converts consecutive failing closes into STRUCTURE instead of
 * vibes: each failing run advances the project's open escalation one rung,
 * and the rung shapes the NEXT already-scheduled autopilot dispatch (the
 * objection is fed back to the agent first — humans see only what agents
 * can't route around). The ladder never dispatches anything by itself:
 * uncapped auto-retry is how fleets burn money, so cadence stays owned by
 * the existing autopilot loop and its cooldowns.
 *
 * The top rung is the failure brake: FAILURE_BRAKE_STREAK in
 * dispatch-gates.ts imports ESCALATION_HUMAN_STREAK so "autopilot stops"
 * and "a human is alerted" are the same rung by construction and can never
 * drift apart.
 */

import { isFailingOutcome } from "@/lib/events";

export const ESCALATION_LEVELS = ["retry", "patch", "replan", "human"] as const;
export type EscalationLevel = (typeof ESCALATION_LEVELS)[number];

/** Streak at which the ladder reaches 'human' — and the failure brake trips. */
export const ESCALATION_HUMAN_STREAK = 4;

/** Map a consecutive-failure streak onto a rung. Streak ≤ 0 has no rung. */
export function levelForStreak(failStreak: number): EscalationLevel | null {
  if (failStreak <= 0) return null;
  return ESCALATION_LEVELS[Math.min(failStreak, ESCALATION_HUMAN_STREAK) - 1];
}

/**
 * The rung-specific instruction injected into the next dispatch. Deliberately
 * forceful at each step: same-approach retries are only sanctioned on rung 1.
 */
export function escalationInstruction(level: EscalationLevel): string {
  switch (level) {
    case "retry":
      return (
        "Your previous run on this project FAILED (reason below). Diagnose whether the failure " +
        "was transient (network, rate limit, flaky test). If so, retry the same objective carefully; " +
        "if not, treat this as rung 2 and fix the blocker before continuing."
      );
    case "patch":
      return (
        "The last TWO runs on this project failed. Do NOT retry the same approach. First find and " +
        "fix the underlying blocker (broken build, failing test, bad state, missing dependency), " +
        "verify the fix, and only then continue the original objective."
      );
    case "replan":
      return (
        "THREE consecutive runs failed — the current approach is not working. Step back and re-plan: " +
        "state in the session handoff why the previous attempts failed, choose a genuinely different " +
        "approach or a much smaller verifiable step, and pursue that instead. If nothing viable " +
        "remains, write status: blocked with a block-reason so a human decision is requested."
      );
    case "human":
      return (
        "Four consecutive runs failed. Autopilot is braked and the operator has been alerted — " +
        "do not attempt further automated work on this objective."
      );
  }
}

/**
 * What one closed run does to the project's ladder.
 *
 * WHY THIS EXISTS — the one-way door
 * ----------------------------------
 * The ladder used to ADVANCE on `isFailingOutcome(outcome)` but RESOLVE only on
 * `outcome === "success"`. Two locally sensible rules — "incomplete work is not
 * a failure" and "don't declare victory early" — composed into a state with no
 * exit: `partial` could neither climb the ladder nor clear it, and `partial` is
 * the most common outcome there is (52 of 117 closes measured 2026-08-26).
 *
 * So ladders stayed open indefinitely. Seventeen were open at once, none of
 * them with a single `success` since opening: surf-your-life sat at the top
 * rung for 13 days while completing 7 runs' worth of real work, and orangecat's
 * open rungs kept injecting "your previous run FAILED" into dispatch prompts
 * for a project that was working.
 *
 * The failure brake never had this bug: `leadingFailureStreak` stops at the
 * first non-failing outcome, so a `partial` resets it. orchestration-runs.ts
 * even claimed the two agreed — "isFailingOutcome is the same predicate the
 * failure brake uses, so ladder rungs and brake streak count the same events"
 * — which was true for advancing and false for resetting. That divergence IS
 * the bug.
 *
 * Hence one function, used by every close path, symmetric by construction:
 * whatever does not count as a failure resets the failure streak.
 */
export type LadderEffect =
  { kind: "advance" } | { kind: "resolve"; by: "success" | "progress" } | { kind: "ignore" };

export function ladderEffectForClose(
  outcome: string | null | undefined,
  /** The closed run. A fresh one-off (inject `session: "fresh"`) is a side
   *  question, not the project's work: it neither clears nor adds to the
   *  project's ladder. */
  run?: { payload?: unknown } | null,
): LadderEffect {
  if (outcome == null) return { kind: "ignore" };
  if ((run?.payload as { oneOff?: unknown } | null | undefined)?.oneOff === true) {
    return { kind: "ignore" };
  }
  if (isFailingOutcome(outcome)) return { kind: "advance" };
  // Neutral by definition — a human choosing to stop is neither evidence that
  // the project is stuck nor evidence that it is moving. It must not clear a
  // streak it did not earn, and must not add to one either.
  if (outcome === "user_abort") return { kind: "ignore" };
  // Everything else is a close where work landed. `success` means the goal was
  // met; `partial` means real work happened and the bar was not cleared. Both
  // are proof the project is moving, which is the only thing the ladder is
  // supposed to measure — it tracks whether progress is happening, not whether
  // a run earned a perfect grade.
  return { kind: "resolve", by: outcome === "success" ? "success" : "progress" };
}

export interface EscalationView {
  level: EscalationLevel;
  failStreak: number;
  lastError?: string | null;
  /** What the most recent failing close actually was. Load-bearing: a streak
   *  built from unconfirmed dispatches must not be described to the agent as
   *  its own failing work. */
  lastOutcome?: string | null;
}

/**
 * Render the block injected into dispatch prompts. Returns null at 'human'
 * (nothing should be dispatching then — the brake owns that state).
 */
export function renderEscalationBlock(esc: EscalationView): string | null {
  if (esc.level === "human") return null;
  const rung = ESCALATION_LEVELS.indexOf(esc.level) + 1;

  // The streak is real, but its cause was not this agent's work. Every rung's
  // instruction tells the reader to diagnose, patch or re-plan ITS OWN
  // previous attempt — advice that is not merely useless when the prompt never
  // arrived, but actively misleading: it invites an agent to go looking for a
  // defect in work that was never done, on a project that may be fine.
  if (esc.lastOutcome === "unconfirmed") {
    return [
      `## Escalation state (operator dispatch pipeline — rung ${rung}/${ESCALATION_LEVELS.length})`,
      `The previous ${esc.failStreak} dispatch(es) on this project were injected but never picked up by an agent — ` +
        `no work was attempted, and nothing failed on your side. ` +
        `Proceed with the objective normally. Do NOT treat this as a failed prior attempt or go looking for a blocker that caused it.`,
    ].join("\n");
  }

  const lines = [
    `## Escalation state (operator dispatch pipeline — rung ${rung}/${ESCALATION_LEVELS.length}: ${esc.level.toUpperCase()})`,
    escalationInstruction(esc.level),
  ];
  if (esc.lastError) {
    lines.push(`Last recorded failure: ${esc.lastError.slice(0, 500)}`);
  }
  return lines.join("\n");
}
