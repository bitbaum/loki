/**
 * "Ship fixes automatically" — who presses merge on an agent's fix.
 *
 * The agent's job ends at a pull request, and until someone merges it the
 * visitor's report is not fixed. Off (the default) the feedback row asks the
 * operator; on, Loki merges the PR itself once it is genuinely green.
 *
 * WHY LOKI MERGES, AND NOT AN auto-merge.yml IN THE REPO. A workflow
 * would be a commit in someone else's repository: it has to be back-filled
 * into repos Loki never provisioned (annushka's was made by hand), it
 * drifts, turning it off needs another commit, and — the real objection — it
 * merges ANY green pull request, including one a person opened for something
 * unrelated. Loki already watches the exact PR its own dispatch
 * produced (the fix ledger), so merging that one and nothing else is both
 * narrower and instant: the setting applies to PRs already open and leaves no
 * trace in the repo when it is turned back off.
 *
 * This module is the decision, with no I/O, so every condition below is
 * testable without GitHub.
 */
import { FIX_SHIP_STATE, type FixShipping } from "@/lib/feedback/fix-shipping";

export const AUTO_SHIP_HOLD = {
  /** The project has not opted in (null = never chosen, false = chosen off). */
  NOT_ENABLED: "not_enabled",
  /** Nothing to merge: no PR, or it is already merged/closed. */
  NOT_OPEN: "not_open",
  /** This PR did not come from a Loki dispatch. Never touch it. */
  NOT_OURS: "not_ours",
  /** Draft, or GitHub says it cannot merge (conflicts, blocked). */
  NOT_MERGEABLE: "not_mergeable",
  /**
   * GitHub has not finished computing mergeability (`mergeable: null`). Still
   * a hold — unknown is never permission — but a DIFFERENT one, because the
   * row must not tell a person their pull request has conflicts when nobody
   * has looked yet. This resolves itself on the next refresh.
   */
  MERGE_UNKNOWN: "merge_unknown",
  /** A required check failed or is still running. */
  CHECKS_NOT_GREEN: "checks_not_green",
  /** The repo runs no checks at all. Absence of red is not evidence of green. */
  NO_CHECKS: "no_checks",
  /** The last automatic ship on this project broke the deploy. */
  DEPLOY_BROKEN: "deploy_broken",
} as const;
export type AutoShipHold = (typeof AUTO_SHIP_HOLD)[keyof typeof AUTO_SHIP_HOLD];

export type AutoShipDecision = { merge: true } | { merge: false; hold: AutoShipHold };

export type AutoShipInput = {
  /** user_projects.auto_ship — null means the operator has never chosen. */
  autoShip: boolean | null | undefined;
  /** The run's fix ledger. */
  fix: FixShipping | null | undefined;
  /**
   * Did THIS run open this pull request? Established by
   * prOpenedByRun() from GitHub's own created_at, never asserted.
   */
  fromOurDispatch: boolean;
  /** GitHub: pull.draft. */
  draft: boolean;
  /** GitHub: pull.mergeable — null while GitHub is still computing it. */
  mergeable: boolean | null;
  /** Conclusions of the checks on the PR head, GitHub's own words. */
  checkConclusions: readonly (string | null)[];
  /** Has an automatic ship on this project already produced a failed deploy? */
  deployBroken: boolean;
};

/**
 * Does this pull request belong to this run?
 *
 * The guard existed as a field and was passed a hardcoded `true`, which made it
 * decoration. It matters: the pull request is resolved from PROSE the agent
 * wrote, and a handoff that merely mentions a number ("same approach as PR
 * #42") would otherwise hand that number to the merge call. #42 could be a
 * person's unrelated work.
 *
 * The hard fact is when GitHub says the pull request was opened. A run creates
 * its row at dispatch, before any agent touches the repo, so a pull request the
 * run produced is always NEWER than the run. One minute of slack absorbs clock
 * skew between GitHub and the box; anything older belongs to someone else, or
 * to a previous attempt — which is exactly the retry case that first exposed
 * this (a handoff naming both the superseded pull request and the new one).
 */
export const RUN_CLOCK_SLACK_MS = 60_000;

export function prOpenedByRun(
  prCreatedAt: string | null | undefined,
  runStartedAt: string | Date | null | undefined,
): boolean {
  if (!prCreatedAt || !runStartedAt) return false;
  const pr = Date.parse(prCreatedAt);
  const run = typeof runStartedAt === "string" ? Date.parse(runStartedAt) : runStartedAt.getTime();
  if (!Number.isFinite(pr) || !Number.isFinite(run)) return false;
  return pr >= run - RUN_CLOCK_SLACK_MS;
}

/**
 * GitHub says this pull request already existed when the run was dispatched,
 * so the run cannot have produced it.
 *
 * NOT the negation of prOpenedByRun, and the difference is the point. That one
 * answers "may Loki press merge on this?", where the safe answer to *unknown*
 * is no. This one answers "may Loki tell the operator their report shipped?",
 * where the safe answer to unknown is *keep believing the ledger* — demoting a
 * real fix to "nothing shipped" because GitHub omitted a timestamp would break
 * every honest row to catch a dishonest one. So both predicates return false
 * when either timestamp is missing or unparseable, and only a PROVEN ordering
 * moves anything.
 */
export function prPredatesRun(
  prCreatedAt: string | null | undefined,
  runStartedAt: string | Date | null | undefined,
): boolean {
  if (!prCreatedAt || !runStartedAt) return false;
  const pr = Date.parse(prCreatedAt);
  const run = typeof runStartedAt === "string" ? Date.parse(runStartedAt) : runStartedAt.getTime();
  if (!Number.isFinite(pr) || !Number.isFinite(run)) return false;
  return pr < run - RUN_CLOCK_SLACK_MS;
}

/** GitHub conclusions that mean "this check is not a reason to stop". */
const PASSING = new Set(["success", "neutral", "skipped"]);

export function decideAutoShip(input: AutoShipInput): AutoShipDecision {
  if (input.autoShip !== true) return { merge: false, hold: AUTO_SHIP_HOLD.NOT_ENABLED };
  if (input.deployBroken) return { merge: false, hold: AUTO_SHIP_HOLD.DEPLOY_BROKEN };
  if (!input.fix?.pr || input.fix.state !== FIX_SHIP_STATE.PR_OPEN)
    return { merge: false, hold: AUTO_SHIP_HOLD.NOT_OPEN };
  // An unverified ledger is the agent's claim, not GitHub's answer. Never
  // merge on a claim — the org-restriction 403 produced exactly that shape.
  if (input.fix.unverified) return { merge: false, hold: AUTO_SHIP_HOLD.NOT_OPEN };
  if (!input.fromOurDispatch) return { merge: false, hold: AUTO_SHIP_HOLD.NOT_OURS };
  if (input.draft || input.mergeable === false)
    return { merge: false, hold: AUTO_SHIP_HOLD.NOT_MERGEABLE };
  if (input.mergeable !== true) return { merge: false, hold: AUTO_SHIP_HOLD.MERGE_UNKNOWN };
  // "No checks configured" is UNKNOWN, not green. dogfood-site-sep10-1201's
  // first agent PR had zero checks; merging it would have been merging on no
  // evidence at all, which is the thing this whole feature exists to avoid.
  if (input.checkConclusions.length === 0) return { merge: false, hold: AUTO_SHIP_HOLD.NO_CHECKS };
  if (!input.checkConclusions.every((c) => c !== null && PASSING.has(c)))
    return { merge: false, hold: AUTO_SHIP_HOLD.CHECKS_NOT_GREEN };
  return { merge: true };
}

/**
 * Which projects have automatic shipping paused because a fix it merged failed
 * to deploy.
 *
 * Pure, and exported, because the rule that matters is the STATUS FILTER and
 * that lived in a loop nothing could test. Without it, resolving the broken row
 * did not lift the pause — a deploy_failed ledger is terminal, so the project
 * stayed paused forever with no action in the product that could end it. A
 * pause nobody can lift is a dead end, not a safety feature.
 */
export function projectsPausedByBrokenDeploy(
  items: ReadonlyArray<{ projectId: string; status: string }>,
  fixOf: (item: { projectId: string; status: string }) => { state?: string } | null | undefined,
  handledStatuses: ReadonlyArray<string>,
): Set<string> {
  const paused = new Set<string>();
  for (const item of items) {
    if (handledStatuses.includes(item.status)) continue;
    if (fixOf(item)?.state === FIX_SHIP_STATE.DEPLOY_FAILED) paused.add(item.projectId);
  }
  return paused;
}

/** What the row says when automatic shipping looked and decided not to. Only
 *  the holds a person can act on get a sentence; the rest are silence. */
export function autoShipHoldNote(hold: AutoShipHold): string | null {
  switch (hold) {
    case AUTO_SHIP_HOLD.NO_CHECKS:
      return "Automatic shipping is on, but this repository runs no checks — so there is nothing to prove the fix is safe. Merge it yourself, or add a check.";
    case AUTO_SHIP_HOLD.CHECKS_NOT_GREEN:
      return "Automatic shipping is on and waiting for checks to pass.";
    case AUTO_SHIP_HOLD.NOT_MERGEABLE:
      return "Automatic shipping is on, but GitHub cannot merge this pull request — it is a draft or has conflicts.";
    case AUTO_SHIP_HOLD.MERGE_UNKNOWN:
      return "Automatic shipping is on; GitHub has not finished checking whether this can merge. It retries on its own.";
    case AUTO_SHIP_HOLD.DEPLOY_BROKEN:
      return "Automatic shipping is paused for this project: the last fix it merged failed to deploy. Fix that one first.";
    default:
      return null;
  }
}
