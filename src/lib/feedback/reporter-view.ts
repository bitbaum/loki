/**
 * What a REPORTER is told about their own report.
 *
 * The reporter is not the operator. They may be a stranger who clicked the
 * widget on a customer site, and the only thing they are owed is the truth
 * about the report they filed — not a window into the fleet that is fixing it.
 *
 * So this layer exists to do two jobs at once, and the second is the reason it
 * is a separate module rather than a `label` field on FeedbackWorkView:
 *
 *  1. Say the honest phase. `/my-feedback` used to map the four DB statuses
 *     through a dictionary, which meant `dispatched` rendered as "Being
 *     implemented" whether an agent was mid-run, had crashed three days
 *     earlier, or had shipped a fix nobody had clicked Resolve on yet. See
 *     work-phase.ts, which opens by saying DB status cannot answer this.
 *
 *  2. Leak nothing while doing it. FeedbackWorkView is written for the person
 *     who owns the machine: `detail` carries builder asks ("Open Fleet Runner
 *     on This computer"), `diagnostic` carries the agent's raw error,
 *     `stepSummary` narrates run hops, and `runId` / `commandId` are internal
 *     handles. Every one of those is operator-only. This module therefore
 *     WRITES ITS OWN SENTENCES per phase instead of forwarding any string from
 *     the work view — a pass-through would have been shorter and would have
 *     put an engineer's note about a sibling run on a stranger's screen.
 *
 * The rule to keep: a field added to FeedbackWorkView must never reach a
 * reporter by default. Adding one here has to be a deliberate line of code,
 * and scripts/test/feedback-reporter-view.ts fails if any known operator-only
 * string appears in the output.
 */
import { FEEDBACK_WORK_PHASE, type FeedbackWorkView } from "@/lib/feedback/work-phase";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";

/** Visual weight for the status chip — maps to the ui-tag-* variants. */
export type ReporterTone = "neutral" | "accent" | "warning" | "positive";

export type ReporterStatus = {
  /** The chip word. Never a DB status ("dispatched" is not a human word). */
  label: string;
  tone: ReporterTone;
  /** One reporter-facing sentence. Always written here, never forwarded. */
  detail: string;
  /** The reporter's own next move, when they have one. */
  action: { href: string; label: string } | null;
};

/**
 * A fix that is written but not yet on the live site. Split out because the
 * reporter's sentence differs from the operator's in kind: the operator is
 * told where the pull request is, the reporter is told only that a change
 * exists and is on its way. Repo names, PR numbers and deploy workflows are
 * the operator's business.
 */
const ON_THE_WAY: ReadonlySet<string> = new Set([
  FIX_SHIP_STATE.PUSHED,
  FIX_SHIP_STATE.PR_OPEN,
  FIX_SHIP_STATE.MERGED,
  FIX_SHIP_STATE.DEPLOYING,
]);

export function reporterStatusFor(
  work: FeedbackWorkView,
  opts: { liveHref?: string | null } = {},
): ReporterStatus {
  const liveHref = opts.liveHref ?? null;
  const checkLive = liveHref ? { href: liveHref, label: "Check the live page" } : null;

  switch (work.phase) {
    case FEEDBACK_WORK_PHASE.NOT_STARTED:
      return {
        label: "Received",
        tone: "neutral",
        detail: "Filed and waiting for the maintainer to pick it up.",
        action: null,
      };

    case FEEDBACK_WORK_PHASE.QUEUED:
      return {
        label: "Queued",
        tone: "accent",
        detail: "Accepted and queued for work to start.",
        action: null,
      };

    case FEEDBACK_WORK_PHASE.WORKING:
      return {
        label: "Being implemented",
        tone: "accent",
        detail: "Someone is working on it right now.",
        action: null,
      };

    // Stuck and Failed differ in what already happened — a run that never
    // started vs one that started and died — but not in what the REPORTER
    // does about it, which is nothing. Both get the honest word and the
    // honest owner, and neither gets the builder ask that would tell them
    // which of the maintainer's machines is down.
    case FEEDBACK_WORK_PHASE.STUCK:
    case FEEDBACK_WORK_PHASE.FAILED:
      return {
        label: "Stalled",
        tone: "warning",
        detail: "The first attempt did not finish. It is back with the maintainer.",
        action: null,
      };

    case FEEDBACK_WORK_PHASE.NEEDS_VERIFY: {
      const ship = work.ship?.state ?? null;
      if (ship && ON_THE_WAY.has(ship)) {
        return {
          label: "Fix on the way",
          tone: "accent",
          detail: "A change has been written and is on its way to the live site.",
          action: null,
        };
      }
      if (ship === FIX_SHIP_STATE.DEPLOYED || work.checkLive === true) {
        return {
          label: "Fix is live",
          tone: "positive",
          detail: "A fix shipped. Have a look and tell us if it is still wrong.",
          action: checkLive,
        };
      }
      // No ledger yet, or a PR that was closed without merging. Claiming a fix
      // shipped here is the closed-loop lie work-phase.ts exists to prevent.
      return {
        label: "Being implemented",
        tone: "accent",
        detail: "Work has finished; the change is being checked before it goes live.",
        action: null,
      };
    }

    case FEEDBACK_WORK_PHASE.DONE:
      return {
        label: "Implemented",
        tone: "positive",
        detail: "Marked done by the maintainer.",
        action: checkLive,
      };

    case FEEDBACK_WORK_PHASE.ARCHIVED:
      return {
        label: "Closed",
        tone: "neutral",
        detail: "Closed without a change.",
        action: null,
      };
  }
}

/** ui-tag variant for a tone. Kept beside the tones so a new tone cannot be
 *  added without deciding how it looks. */
export function reporterToneClass(tone: ReporterTone): string {
  switch (tone) {
    case "positive":
      return "ui-tag-positive";
    case "warning":
      return "ui-tag-warning";
    case "accent":
      return "ui-tag-accent";
    case "neutral":
      return "ui-tag-neutral";
  }
}
