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
import {
  FEEDBACK_WORK_PHASE,
  WAITING_ON,
  type FeedbackWorkView,
  type WaitingOn,
} from "./work-phase";

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
  /** Marked done, but PR, merge, deploy or a live URL is not on record. */
  DONE_UNPROVEN: "done_unproven",
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
  /**
   * The exact call that does it, when there is one (needs the report's id, so
   * only present when the caller passed `feedbackId`). Same-origin path; the
   * caller's own token or session authorises it. Null: the move is a person's
   * look at a page, or a wait.
   */
  request: { method: "POST"; path: string; body?: Record<string, unknown> } | null;
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

/** What Done needs on record. Reported when a Done is demoted. */
export type MissingProof = "pr" | "merge" | "deploy" | "live_url";

export type CanonicalStatus = {
  state: CanonicalState;
  label: string;
  cause: CanonicalCause;
  /**
   * Why, in a sentence — present on EVERY Failed and Needs you (never empty),
   * null on the states where nothing is wrong. The code in `cause` is for
   * switching; this is for reading.
   */
  reason: string | null;
  nextAction: CanonicalNextAction;
  evidence: CanonicalEvidence;
  /** Only on cause `done_unproven`: which of the four proofs is absent. */
  missing?: MissingProof[];
};

/**
 * What a seat that cannot dispatch (a Viewer or Reporter, a machine filer) is
 * told next to the state: the cause code, a reason and the one next move, so a
 * bare "Needs you" never reaches it. Written here, never forwarded: reasons
 * and actions in CanonicalStatus name builders, pull requests and retries,
 * which are the operator's. No `request` (it cannot dispatch), no evidence.
 */
export type SeatStatus = Pick<CanonicalStatus, "state" | "label" | "reason"> & {
  /** A cause that says nothing of the machine, else `needs_owner`; null while it moves. */
  cause: CanonicalCause | "needs_owner" | null;
  nextAction: { kind: NextActionKind; who: "owner" | "nobody" | "loki"; label: string };
};

const SEAT_CAUSES: ReadonlySet<CanonicalCause> = new Set([
  CANONICAL_CAUSE.AWAITING_IMPLEMENT,
  CANONICAL_CAUSE.CLOSED_WITHOUT_CHANGE,
  CANONICAL_CAUSE.DONE_UNPROVEN,
  CANONICAL_CAUSE.CONFIRMED,
]);

/**
 * The report is closed (archived, or marked done without proof on record):
 * nobody is going to act on it, so a seat is never told the owner "has to act"
 * or to poll again. What it can still do is its own: look, and file anew.
 */
const SEAT_CLOSED: Partial<Record<CanonicalCause, { reason: string; label: string }>> = {
  [CANONICAL_CAUSE.CLOSED_WITHOUT_CHANGE]: {
    reason: "The report was closed and no change was made for it.",
    label:
      "Nothing is pending: the report is closed and nobody is working on it. File a new report if the problem is still there.",
  },
  [CANONICAL_CAUSE.DONE_UNPROVEN]: {
    reason:
      "The report was closed as done, but no change reaching the live site is on record for it.",
    label:
      "Nothing is pending: the report is closed. Look at the live page yourself, and file a new report if the problem is still there.",
  },
};

export function seatStatus(full: CanonicalStatus): SeatStatus {
  const { state, label } = full;
  const moving =
    state === CANONICAL_STATE.QUEUED ||
    state === CANONICAL_STATE.STARTING ||
    state === CANONICAL_STATE.WORKING;
  const cause: SeatStatus["cause"] = moving
    ? null
    : SEAT_CAUSES.has(full.cause)
      ? full.cause
      : "needs_owner";
  const base = { state, label, cause };
  if (state === CANONICAL_STATE.DONE)
    return { ...base, reason: null, nextAction: { kind: "none", who: "nobody", label: "Nothing" } };
  const closed = SEAT_CLOSED[full.cause];
  if (closed)
    return {
      ...base,
      reason: closed.reason,
      nextAction: { kind: "none", who: "nobody", label: closed.label },
    };
  if (state === CANONICAL_STATE.NEEDS_YOU || state === CANONICAL_STATE.FAILED) {
    const unstarted = cause === CANONICAL_CAUSE.AWAITING_IMPLEMENT;
    return {
      ...base,
      reason: unstarted
        ? "Filed and received. No build has been started for it; filing never starts one."
        : state === CANONICAL_STATE.FAILED
          ? "The work on this report ended without a change on the live site."
          : "The work on this report stopped short of live and needs the project's owner.",
      nextAction: {
        kind: "wait",
        who: "owner",
        label: unstarted
          ? "Nothing to do: the project's owner or an editor decides whether to start the build. Poll again later."
          : "Nothing to do: the project's owner or an editor has to act on it. Poll again later.",
      },
    };
  }
  return {
    ...base,
    reason: null,
    nextAction: { kind: "wait", who: "loki", label: "Wait: it is moving by itself. Poll again." },
  };
}

const act = (kind: NextActionKind, who: WaitingOn, label: string): CanonicalNextAction => ({
  kind,
  who,
  label,
  request: null,
});

/** Done is earned: a pull request, its merge, a deploy seen, and a live URL. */
export function missingProof(e: CanonicalEvidence): MissingProof[] {
  const out: MissingProof[] = [];
  if (!e.pr) out.push("pr");
  if (!e.merged) out.push("merge");
  if (!e.deployed) out.push("deploy");
  if (!e.liveUrl) out.push("live_url");
  return out;
}

const REASON: Record<CanonicalCause, string> = {
  awaiting_implement: "No build has been started for this report.",
  waiting_for_builder: "Queued on a builder that has not picked it up yet.",
  agent_starting: "A builder claimed it and is starting the agent.",
  agent_generating: "The agent is writing the change.",
  builder_offline: "The builder this was queued on is offline, so nothing is running.",
  stalled: "The run stopped producing output and has not finished.",
  run_failed: "The agent run ended without finishing the change.",
  looking_up_result: "The run closed; GitHub is being asked what it produced.",
  nothing_shipped: "The run reported success but no branch, commit or pull request exists.",
  pushed_no_pr: "A branch was pushed but no pull request was opened.",
  pr_open: "The pull request is open and not merged yet.",
  pr_closed: "The pull request was closed without merging, so nothing shipped.",
  merged_no_deploy_seen: "The change is merged but no deploy has been seen on it.",
  deploying: "Merged; the deploy is still running.",
  deploy_failed: "Merged, but the deploy failed, so the change is not live.",
  live_unconfirmed: "Deployed; nobody has confirmed the live page shows the change.",
  confirmed: "Pull request merged, deployed and confirmed live.",
  closed_without_change: "The report was closed and no change was made for it.",
  done_unproven: "Marked done, but the proof Done needs is not on record.",
};

/** The dispatch call: a retry, or the first start. */
function dispatchRequest(id: string | undefined): CanonicalNextAction["request"] {
  return id ? { method: "POST", path: `/api/feedback/${id}/dispatch`, body: {} } : null;
}

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
  opts: { liveUrl?: string | null; feedbackId?: string } = {},
): CanonicalStatus {
  const evidence = evidenceFrom(work.ship, opts.liveUrl ?? null);
  const make: Make = (state, cause, nextAction) => {
    const problem = state === CANONICAL_STATE.FAILED || state === CANONICAL_STATE.NEEDS_YOU;
    // A retry or a start is the dispatch call; an offline builder is rerouted.
    const request =
      nextAction.kind === "retry" || nextAction.kind === "implement"
        ? (nextAction.request ?? dispatchRequest(opts.feedbackId))
        : nextAction.request;
    return {
      state,
      label: CANONICAL_LABEL[state],
      cause,
      reason: problem ? REASON[cause] : null,
      nextAction: { ...nextAction, request },
      evidence,
    };
  };

  switch (work.phase) {
    case FEEDBACK_WORK_PHASE.NOT_STARTED:
      return make(
        CANONICAL_STATE.NEEDS_YOU,
        CANONICAL_CAUSE.AWAITING_IMPLEMENT,
        act("implement", work.waitingOn, "Start the build"),
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
        ? make(CANONICAL_STATE.NEEDS_YOU, CANONICAL_CAUSE.BUILDER_OFFLINE, {
            ...act("retry", work.waitingOn, "Hand it to the cloud builder"),
            request: work.commandId
              ? {
                  method: "POST",
                  path: "/api/control/reroute",
                  body: { commandId: work.commandId },
                }
              : null,
          })
        : make(
            CANONICAL_STATE.NEEDS_YOU,
            CANONICAL_CAUSE.STALLED,
            act("retry", work.waitingOn, "Retry the build on the same builder"),
          );
    case FEEDBACK_WORK_PHASE.FAILED: {
      const s = work.ship?.state;
      const cause =
        s === FIX_SHIP_STATE.PR_CLOSED
          ? CANONICAL_CAUSE.PR_CLOSED
          : s === FIX_SHIP_STATE.DEPLOY_FAILED
            ? CANONICAL_CAUSE.DEPLOY_FAILED
            : CANONICAL_CAUSE.RUN_FAILED;
      const label =
        cause === CANONICAL_CAUSE.PR_CLOSED
          ? "Retry: the closed pull request shipped nothing, so build it again"
          : cause === CANONICAL_CAUSE.DEPLOY_FAILED
            ? "Fix the failing deploy on the merge commit, then retry if the change is gone"
            : "Retry the build; switch agent if the cause was a limit or login";
      return make(CANONICAL_STATE.FAILED, cause, act("retry", work.waitingOn, label));
    }
    case FEEDBACK_WORK_PHASE.NEEDS_VERIFY:
      return verifyStatus(work, make);
    case FEEDBACK_WORK_PHASE.DONE: {
      // Done is earned, not recorded: an operator's Resolve alone, or a ledger
      // that never saw the deploy, is not Done to an agent reading this.
      const missing = missingProof(evidence);
      if (missing.length === 0)
        return make(
          CANONICAL_STATE.DONE,
          CANONICAL_CAUSE.CONFIRMED,
          act("none", work.waitingOn, "Nothing"),
        );
      const gaps = missing.join(", ");
      return {
        ...make(
          CANONICAL_STATE.NEEDS_YOU,
          CANONICAL_CAUSE.DONE_UNPROVEN,
          act(
            "check_live",
            WAITING_ON.YOU,
            `Open the live page and confirm the change; not on record: ${gaps}`,
          ),
        ),
        missing,
      };
    }
    case FEEDBACK_WORK_PHASE.ARCHIVED:
      // Closed with nothing shipped. Not a success, so not Done: Failed, with
      // the cause saying it was closed and the next action saying how to reopen.
      return make(
        CANONICAL_STATE.FAILED,
        CANONICAL_CAUSE.CLOSED_WITHOUT_CHANGE,
        act("retry", work.waitingOn, "Reopen by building it again, if the change is still wanted"),
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
        act("retry", who, "Retry the build, or archive the report if it needed no code change"),
      );
    case FIX_SHIP_STATE.PUSHED:
      return make(
        CANONICAL_STATE.NEEDS_YOU,
        CANONICAL_CAUSE.PUSHED_NO_PR,
        act("open_pr", who, "Open a pull request from the pushed branch"),
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
      return make(
        CANONICAL_STATE.FAILED,
        CANONICAL_CAUSE.PR_CLOSED,
        act("retry", who, "Retry: the closed pull request shipped nothing, so build it again"),
      );
    case FIX_SHIP_STATE.MERGED:
      return make(
        CANONICAL_STATE.NEEDS_YOU,
        CANONICAL_CAUSE.MERGED_NO_DEPLOY_SEEN,
        act("check_live", who, "Open the live page; no deploy was seen, so look for the change"),
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
        act(
          "retry",
          who,
          "Fix the failing deploy on the merge commit, then retry if the change is gone",
        ),
      );
    case FIX_SHIP_STATE.DEPLOYED:
      return make(
        CANONICAL_STATE.NEEDS_YOU,
        CANONICAL_CAUSE.LIVE_UNCONFIRMED,
        act("check_live", who, "Open the live page and confirm the change is there"),
      );
  }
}
