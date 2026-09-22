/**
 * What "this project needs you" means — in one place.
 *
 * ── The defect this closes ─────────────────────────────────────────────────
 * Measured on production 2026-09-22, the same login, minutes apart:
 *
 *   /control hero    "1 project needs you — loki"
 *   /today verdict   "7 things need you", and the project it names is evig
 *   /projects chip   "Site issues 1" — evig
 *
 * /projects and /today agree (one owner, #857). Control overlaps with
 * NEITHER. It counts projects whose agent SESSION or last RUN is unhealthy;
 * the other two count raised flags (security / broken features / deploy issue
 * / site down). Same three words, three different populations.
 *
 * So the front door said seven things needed the operator, and Control — one
 * click away — named a project that was in none of the seven. Trust /today and
 * you miss a blocked agent; trust /control and you miss an authentication
 * bypass. A front door that is incomplete teaches you to check everything
 * anyway, which is the whole thing it exists to stop.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * This module is the ONLY definition of agent-attention. It takes the two
 * health strings and nothing else, so any caller holding them can ask — a
 * client component with live SSE state (Control) and a server component with
 * two DB reads (/today) both satisfy it, and they cannot drift, because there
 * is one rule to drift from.
 *
 * The scoring is preserved exactly as `attentionScore` had it in
 * control-presenter.ts, including the `score <` guards, which stop a project
 * being counted twice for the same trouble seen in two places.
 */

/** The minimum an attention verdict needs. Both callers can produce it. */
export type ProjectAttentionInput = {
  /** `project_states.session_health` — the agent's own report. */
  sessionHealth: string | null | undefined;
  /** `orchestration_runs.summary.health` for the latest run. */
  runHealth: string | null | undefined;
};

export type ProjectAttentionVerdict = {
  score: number;
  /** The first reason, in the words Control has always used. */
  reason: string;
};

/**
 * Score a project's need for the operator.
 *
 * Returned reasons are deliberately the exact strings Control shipped —
 * "critical", "needs attention", "last run: critical", "last run: needs
 * attention" — so the two surfaces name the same trouble the same way. A
 * reader should never have to work out whether two pages mean one thing.
 */
export function projectAttentionVerdict(input: ProjectAttentionInput): ProjectAttentionVerdict {
  let score = 0;
  const reasons: string[] = [];

  const sessionHealth = input.sessionHealth?.toLowerCase() ?? "";
  if (sessionHealth === "critical") {
    score += 4;
    reasons.push("critical");
  } else if (sessionHealth.includes("attention")) {
    score += 2;
    reasons.push("needs attention");
  }

  const runHealth = input.runHealth?.toLowerCase() ?? "";
  if (runHealth === "critical" && score < 4) {
    score += 3;
    reasons.push("last run: critical");
  } else if (runHealth.includes("attention") && score < 2) {
    score += 2;
    reasons.push("last run: needs attention");
  }

  return { score, reason: reasons[0] ?? "" };
}

/**
 * Does this project need the operator?
 *
 * The predicate, named — so a surface asks the question rather than
 * re-deriving "score > 0" and getting the boundary subtly wrong. `> 0` is not
 * arbitrary: every branch above adds at least 2, so any non-zero score means
 * at least one health signal actually fired.
 */
export function projectNeedsOperator(input: ProjectAttentionInput): boolean {
  return projectAttentionVerdict(input).score > 0;
}
