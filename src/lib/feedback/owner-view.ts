/**
 * What the OWNER is told about their own change, on their own site.
 *
 * The widget's thread ends at "On it — Loki tells you when". It never did,
 * on the site: the telling went to push and Telegram, and the site the owner
 * actually returns to said nothing. So the panel now carries "Your changes",
 * and this module writes the one word and one sentence each row shows —
 * derived from the same honest phase the Loki inbox derives
 * (work-phase.ts), never from the DB status, which cannot tell a running
 * agent from a crashed one.
 *
 * Written here rather than forwarded, for the reason reporter-view.ts gives:
 * FeedbackWorkView is the operator's — builder asks, raw errors, run ids —
 * and a sentence shown on a live site is read by whoever is holding the
 * phone. The owner gets more than a stranger (a way into Loki when something
 * needs them) and still nothing an engineer wrote to another engineer.
 */
import { FEEDBACK_WORK_PHASE, type FeedbackWorkView } from "@/lib/feedback/work-phase";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";

export type OwnerChangeTone = "neutral" | "accent" | "warning" | "positive";

export type OwnerChangeStatus = {
  /** The chip word. Never a DB status. */
  label: string;
  tone: OwnerChangeTone;
  /** One owner-facing sentence. */
  detail: string;
  /** The change is on the live site: the row may say "See it". */
  live: boolean;
  /** Nothing will change any more — the widget stops asking about it. */
  settled: boolean;
  /** Something needs the owner in Loki, not on the site. */
  needsYou: boolean;
};

const ON_THE_WAY: ReadonlySet<string> = new Set([
  FIX_SHIP_STATE.PUSHED,
  FIX_SHIP_STATE.PR_OPEN,
  FIX_SHIP_STATE.MERGED,
  FIX_SHIP_STATE.DEPLOYING,
]);

export function ownerStatusFor(work: FeedbackWorkView): OwnerChangeStatus {
  const base = { live: false, settled: false, needsYou: false };
  switch (work.phase) {
    case FEEDBACK_WORK_PHASE.NOT_STARTED:
      return {
        ...base,
        label: "Waiting",
        tone: "neutral",
        detail: "Saved in Loki. Nothing has started on it yet.",
        needsYou: true,
      };
    case FEEDBACK_WORK_PHASE.QUEUED:
      // Waiting behind another change on the same project is not "Starting":
      // the lane runs one agent at a time, and the owner who sent five fixes
      // needs to see the order, not five rows all claiming to start.
      if (work.detail?.startsWith("Behind "))
        return { ...base, label: "In line", tone: "neutral", detail: work.detail };
      return {
        ...base,
        label: "Starting",
        tone: "accent",
        detail: "An agent is about to pick it up.",
      };
    case FEEDBACK_WORK_PHASE.WORKING:
      return {
        ...base,
        label: "Building",
        tone: "accent",
        detail: "An agent is working on it right now.",
      };
    case FEEDBACK_WORK_PHASE.STUCK:
    case FEEDBACK_WORK_PHASE.FAILED:
      return {
        ...base,
        label: "Needs you",
        tone: "warning",
        detail: "The attempt did not finish. Open it in Loki to see why and try again.",
        needsYou: true,
      };
    case FEEDBACK_WORK_PHASE.NEEDS_VERIFY: {
      const ship = work.ship?.state ?? null;
      if (ship && ON_THE_WAY.has(ship)) {
        return {
          ...base,
          label: "On its way",
          tone: "accent",
          detail: "The change is written and on its way to the live site.",
        };
      }
      if (ship === FIX_SHIP_STATE.DEPLOYED || work.checkLive === true) {
        return {
          ...base,
          label: "Live",
          tone: "positive",
          detail: "It is on the site now. Have a look.",
          live: true,
          settled: true,
        };
      }
      return {
        ...base,
        label: "Checking",
        tone: "accent",
        detail: "The change is written and being checked before it goes live.",
      };
    }
    case FEEDBACK_WORK_PHASE.DONE:
      return {
        ...base,
        label: "Done",
        tone: "positive",
        detail: "Marked done in Loki.",
        live: true,
        settled: true,
      };
    case FEEDBACK_WORK_PHASE.ARCHIVED:
      return {
        ...base,
        label: "Closed",
        tone: "neutral",
        detail: "Closed in Loki without a change.",
        settled: true,
      };
  }
}

/** Mirrors widget/changes.ts. */
export const OWNER_CHANGES_MAX = 12;
/** Rows read before the owner's own are picked out of them. */
export const OWNER_CHANGES_FETCH = 60;
export const OWNER_CHANGE_TEXT_MAX = 200;

/** One row as the widget receives it: the status words, never the work view. */
export type OwnerChange = {
  id: string;
  text: string;
  at: string;
  label: string;
  tone: OwnerChangeTone;
  detail: string;
  live: boolean;
  settled: boolean;
  /** Where "See it" / "Open in Loki" goes, when there is somewhere to go. */
  href: string | null;
  action: string | null;
};

/**
 * A fix Watch can look up by what it noticed (site_feedback.notice_key):
 * where it is, in the owner's words. Every owner row with a key is listed —
 * open or settled — because the question on the next visit is different for
 * each: an open one means "say nothing, it is being fixed"; a live one means
 * "it was fixed, and if it is back, say so"; a closed one means "the owner
 * decided, do not nag".
 */
export type KnownFix = {
  key: string;
  id: string;
  at: string;
  label: string;
  tone: OwnerChangeTone;
  detail: string;
  live: boolean;
  settled: boolean;
  href: string | null;
};

/** How many keyed rows the widget is told about — enough for a whole site. */
export const KNOWN_FIXES_MAX = 100;
