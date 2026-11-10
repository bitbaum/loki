/**
 * The one mapper from a work view to the six canonical statuses
 * (docs/foundation/RUN-STATUS-SSOT.md): Queued, Starting, Working, Needs you,
 * Done, Failed — plus the three things an agent or a person needs next to the
 * word: WHY (`cause`, a stable code), WHAT NEXT (`nextAction`) and the PROOF
 * on hand (`evidence`).
 *
 * Every surface reads this and nothing re-derives it: GET /api/feedback/[id]/
 * status, Watch (`status.canonical`), and the reporter view (state only —
 * `cause`, `nextAction` and `evidence` carry operator detail and stay off a
 * reporter's screen, see reporter-view.ts).
 *
 * Pure: it reads a FeedbackWorkView, never the database.
 */
import { FIX_SHIP_STATE, type FixShipping } from "@/lib/feedback/fix-shipping";
import { FEEDBACK_WORK_PHASE, type FeedbackWorkView, type WaitingOn } from "./work-phase";

export const CANONICAL_STATE = {
  QUEUED: "queued",
  STARTING: "starting",
  WORKING: "working",
  NEEDS_YOU: "needs_you",
  DONE: "done",
  FAILED: "failed",
} as const;
export type CanonicalState = (typeof CANONICAL_STATE)[keyof typeof CANONICAL_STATE];

export const CANONICAL_LABEL: Record<CanonicalState, string> = {
  queued: "Queued",
  starting: "Starting",
  working: "Working",
  needs_you: "Needs you",
  done: "Done",
  failed: "Failed",
};

/** Why the status is what it is. Stable codes: callers may switch on them. */
export const CANONICAL_CAUSE = {
  AWAITING_IMPLEMENT: "awaiting_implement",
  WAITING_FOR_BUILDER: "waiting_for_builder",
  AGENT_STARTING: "agent_starting",
  AGENT_GENERATING: "agent_generating",
  BUILDER_OFFLINE: "builder_offline",
  STALLED: "stalled",
  RUN_FAILED: "run_failed",
  LOOKING_UP_RESULT: "looking_up_result",
  NOTHING_SHIPPED: "nothing_shipped",
  PUSHED_NO_PR: "pushed_no_pr",
  PR_OPEN: "pr_open",
  PR_CLOSED: "pr_closed",
  MERGED_NO_DEPLOY_SEEN: "merged_no_deploy_seen",
  DEPLOYING: "deploying",
  DEPLOY_FAILED: "deploy_failed",
  LIVE_UNCONFIRMED: "live_unconfirmed",
  CONFIRMED: "confirmed",
  CLOSED_WITHOUT_CHANGE: "closed_without_change",
} as const;
export type CanonicalCause = (typeof CANONICAL_CAUSE)[keyof typeof CANONICAL_CAUSE];

export type NextActionKind =
  "implement" | "retry" | "wait" | "open_pr" | "review_pr" | "check_live" | "none";

export type CanonicalNextAction = {
  kind: NextActionKind;
  /** Who has to move: the same WAITING_ON the inbox groups by. */
  who: WaitingOn;
  /** What to do, in a few words. */
  label: string;
};

/** What exists, as seen — never what was merely claimed. */
export type CanonicalEvidence = {
  pr: { number: number; url: string } | null;
  merged: boolean;
  mergeSha: string | null;
  deployed: boolean;
  deployUrl: string | null;
  /** The project's live site, when it has one. */
  liveUrl: string | null;
  /** Loki's own look at the live page, once taken. */
  verified: "looks_fixed" | "not_visible" | "cannot_tell" | null;
  /** The ledger is the agent's claim, GitHub could not be asked. */
  unverified: boolean;
};

export type CanonicalStatus = {
  state: CanonicalState;
  label: string;
  cause: CanonicalCause;
  nextAction: CanonicalNextAction;
  evidence: CanonicalEvidence;
};

const act = (kind: NextActionKind, who: WaitingOn, label: string): CanonicalNextAction => ({
  kind,
  who,
  label,
});

function evidenceFrom(
  ship: FixShipping | null | undefined,
  liveUrl: string | null,
): CanonicalEvidence {
  // A pull request the ledger discounted belongs to other work: not evidence.
  const own = ship && !ship.foreignPr ? ship : null;
  const state = own?.state;
  const merged =
    state === FIX_SHIP_STATE.MERGED ||
    state === FIX_SHIP_STATE.DEPLOYING ||
    state === FIX_SHIP_STATE.DEPLOY_FAILED ||
    state === FIX_SHIP_STATE.DEPLOYED;
  return {
    pr: own?.pr ? { number: own.pr.number, url: own.pr.url } : null,
    merged,
    mergeSha: merged ? (own?.pr?.mergeSha ?? null) : null,
    deployed: state === FIX_SHIP_STATE.DEPLOYED,
    deployUrl: state === FIX_SHIP_STATE.DEPLOYED ? (own?.deploy?.url ?? null) : null,
    liveUrl,
    verified: own?.verify?.verdict ?? null,
    unverified: own?.unverified === true,
  };
}

export function canonicalStatus(
  work: FeedbackWorkView,
  opts: { liveUrl?: string | null } = {},
): CanonicalStatus {
  const evidence = evidenceFrom(work.ship, opts.liveUrl ?? null);
  const make = (
    state: CanonicalState,
    cause: CanonicalCause,
    nextAction: CanonicalNextAction,
  ): CanonicalStatus => ({ state, label: CANONICAL_LABEL[state], cause, nextAction, evidence });

  switch (work.phase) {
    case FEEDBACK_WORK_PHASE.NOT_STARTED:
      return make(
        CANONICAL_STATE.NEEDS_YOU,
        CANONICAL_CAUSE.AWAITING_IMPLEMENT,
        act("implement", work.waitingOn, "Start the work"),
      );
    case FEEDBACK_WORK_PHASE.QUEUED:
      return work.starting
        ? make(
            CANONICAL_STATE.STARTING,
            CANONICAL_CAUSE.AGENT_STARTING,
            act("wait", work.waitingOn, "Wait"),
          )
        : make(
            CANONICAL_STATE.QUEUED,
            CANONICAL_CAUSE.WAITING_FOR_BUILDER,
            act("wait", work.waitingOn, "Wait"),
          );
    case FEEDBACK_WORK_PHASE.WORKING:
      return make(
        CANONICAL_STATE.WORKING,
        CANONICAL_CAUSE.AGENT_GENERATING,
        act("wait", work.waitingOn, "Wait"),
      );
    case FEEDBACK_WORK_PHASE.STUCK:
      return work.rerouteTo
        ? make(
            CANONICAL_STATE.NEEDS_YOU,
            CANONICAL_CAUSE.BUILDER_OFFLINE,
            act("retry", work.waitingOn, "Hand it to the cloud builder"),
          )
        : make(
            CANONICAL_STATE.NEEDS_YOU,
            CANONICAL_CAUSE.STALLED,
            act("retry", work.waitingOn, "Retry"),
          );
    case FEEDBACK_WORK_PHASE.FAILED: {
      const s = work.ship?.state;
      const cause =
        s === FIX_SHIP_STATE.PR_CLOSED
          ? CANONICAL_CAUSE.PR_CLOSED
          : s === FIX_SHIP_STATE.DEPLOY_FAILED
            ? CANONICAL_CAUSE.DEPLOY_FAILED
            : CANONICAL_CAUSE.RUN_FAILED;
      return make(CANONICAL_STATE.FAILED, cause, act("retry", work.waitingOn, "Retry"));
    }
    case FEEDBACK_WORK_PHASE.NEEDS_VERIFY:
      return verifyStatus(work, make);
    case FEEDBACK_WORK_PHASE.DONE:
      return make(
        CANONICAL_STATE.DONE,
        CANONICAL_CAUSE.CONFIRMED,
        act("none", work.waitingOn, "Nothing"),
      );
    case FEEDBACK_WORK_PHASE.ARCHIVED:
      // Closed with nothing shipped. Reported as Done only because the six
      // have no "closed"; `evidence` is empty, and the cause says why.
      return make(
        CANONICAL_STATE.DONE,
        CANONICAL_CAUSE.CLOSED_WITHOUT_CHANGE,
        act("none", work.waitingOn, "Nothing"),
      );
  }
}

type Make = (
  state: CanonicalState,
  cause: CanonicalCause,
  nextAction: CanonicalNextAction,
) => CanonicalStatus;

/** The agent's run closed well; the ledger says how far the change got. */
function verifyStatus(work: FeedbackWorkView, make: Make): CanonicalStatus {
  const who = work.waitingOn;
  const ship = work.ship;
  // No ledger yet: GitHub is still being asked. Nobody's move.
  if (!ship)
    return make(
      CANONICAL_STATE.WORKING,
      CANONICAL_CAUSE.LOOKING_UP_RESULT,
      act("wait", who, "Wait"),
    );
  switch (ship.state) {
    case FIX_SHIP_STATE.NO_EVIDENCE:
      return make(
        CANONICAL_STATE.NEEDS_YOU,
        CANONICAL_CAUSE.NOTHING_SHIPPED,
        act("retry", who, "Retry, or close it if it was not a code change"),
      );
    case FIX_SHIP_STATE.PUSHED:
      return make(
        CANONICAL_STATE.NEEDS_YOU,
        CANONICAL_CAUSE.PUSHED_NO_PR,
        act("open_pr", who, "Open the pull request"),
      );
    case FIX_SHIP_STATE.PR_OPEN:
      // Moves by itself when the repo auto-merges; a person's move otherwise.
      return make(
        CANONICAL_STATE.WORKING,
        CANONICAL_CAUSE.PR_OPEN,
        who === "machine"
          ? act("wait", who, "Wait for checks and merge")
          : act("review_pr", who, "Review the pull request"),
      );
    case FIX_SHIP_STATE.PR_CLOSED:
      return make(CANONICAL_STATE.FAILED, CANONICAL_CAUSE.PR_CLOSED, act("retry", who, "Retry"));
    case FIX_SHIP_STATE.MERGED:
      return make(
        CANONICAL_STATE.NEEDS_YOU,
        CANONICAL_CAUSE.MERGED_NO_DEPLOY_SEEN,
        act("check_live", who, "Check the live page"),
      );
    case FIX_SHIP_STATE.DEPLOYING:
      return make(
        CANONICAL_STATE.WORKING,
        CANONICAL_CAUSE.DEPLOYING,
        act("wait", who, "Wait for the deploy"),
      );
    case FIX_SHIP_STATE.DEPLOY_FAILED:
      return make(
        CANONICAL_STATE.FAILED,
        CANONICAL_CAUSE.DEPLOY_FAILED,
        act("retry", who, "Retry"),
      );
    case FIX_SHIP_STATE.DEPLOYED:
      return make(
        CANONICAL_STATE.NEEDS_YOU,
        CANONICAL_CAUSE.LIVE_UNCONFIRMED,
        act("check_live", who, "Check the live page and confirm"),
      );
  }
}
