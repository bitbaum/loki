/**
 * Loki's recommendation for a report — the ONE tap the owner can make
 * without reading, and why it is the right one.
 *
 * Owner, 2026-10-10: "If my involvement is needed, it shouldn't take me more
 * than 10 milliseconds to do it … I should be able to tap once and have some
 * degree of confidence that this tap will lead to the correct improvement.
 * All the analysis, all the contemplation, all the evaluation will be done
 * before that one option I can tap is given to me."
 *
 * So the feedback page is not an inbox to read; it is a queue of decisions
 * Loki has already made, waiting for a yes. Each row carries one
 * recommendation (this module), the reason in one sentence, and what the
 * tap costs (free, or one agent run). "Do all" takes every yes at once.
 *
 * Derived from the honest phase (work-phase.ts) and the report's own facts.
 * A report with no decision in it (an agent at work, a deploy running) has
 * no recommendation: it is under way, not waiting.
 *
 * Pure. Tested in scripts/test/feedback-recommend.ts.
 */
import { FEEDBACK_SOURCE, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { FEEDBACK_WORK_PHASE, type FeedbackWorkView } from "@/lib/feedback/work-phase";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";
import { STALE_REPORT_DAYS } from "@/config/autopilot-night";

export const RECOMMEND = {
  /** Mark the live fix as done. Free. */
  CONFIRM: "confirm",
  /** Queue an agent run. One run. */
  BUILD: "build",
  /** Queue the run again (a different provider when the last ran out). One run. */
  RETRY: "retry",
  /** Hand a row stuck on a shut laptop to the cloud builder. One run. */
  CLOUD: "cloud",
  /** Archive, with the reason on the row. Free, one tap to undo. */
  FILE: "file",
  /** The project has nowhere to run: a link, not a tap Loki can take for you. */
  CONNECT: "connect",
  /** Live, and only a person's eyes can settle it: the walkthrough is the tap,
   *  "It worked" / "Not fixed" come after. Not taken by "Do all". */
  LOOK: "look",
} as const;
export type RecommendKind = (typeof RECOMMEND)[keyof typeof RECOMMEND];

export type Recommendation = {
  kind: RecommendKind;
  /** The button, as a verb. */
  label: string;
  /** Why this tap, in one sentence. */
  why: string;
  /** What the tap spends: 0 = free, 1 = one agent run on the owner's builder. */
  runs: 0 | 1;
  /** Sort key — the surest, cheapest decisions first. Higher is first. */
  priority: number;
  /** The reason written on an archived row. */
  archiveReason?: string;
};

export type RecommendInput = {
  status: string;
  work: FeedbackWorkView;
  source: string | null;
  createdAt: string | Date;
  duplicateCount: number;
  runnable: boolean;
  page: string | null;
};

const DAY_MS = 86_400_000;
const pageWord = (page: string | null) => (page && page !== "/" ? page : "the home page");

/** How old a report nobody touched may get before filing it away is the right call. */
export function staleAfterDays(source: string | null): number {
  // Loki's own findings and briefs go stale faster than a person's words.
  return source === FEEDBACK_SOURCE.AI_REVIEW || source === FEEDBACK_SOURCE.SYNTHESIZER
    ? 7
    : STALE_REPORT_DAYS;
}

export function recommendFor(input: RecommendInput, now = Date.now()): Recommendation | null {
  const { work } = input;
  if (input.status === FEEDBACK_STATUS.RESOLVED || input.status === FEEDBACK_STATUS.ARCHIVED)
    return null;
  const ageDays = Math.floor((now - new Date(input.createdAt).getTime()) / DAY_MS);
  const times = input.duplicateCount > 1 ? `, reported ${input.duplicateCount} times` : "";

  switch (work.phase) {
    case FEEDBACK_WORK_PHASE.QUEUED:
    case FEEDBACK_WORK_PHASE.WORKING:
      return null;

    case FEEDBACK_WORK_PHASE.NOT_STARTED: {
      if (!input.runnable)
        return {
          kind: RECOMMEND.CONNECT,
          label: "Connect a repository",
          why: "This project has nowhere for an agent to work yet.",
          runs: 0,
          priority: 10,
        };
      const own = input.source === FEEDBACK_SOURCE.OWNER;
      const stale = staleAfterDays(input.source);
      if (!own && ageDays >= stale)
        return {
          kind: RECOMMEND.FILE,
          label: "File away",
          why: `Nobody started this in ${ageDays} days${times}. A report that waited this long was not urgent; it is one tap to bring back.`,
          runs: 0,
          priority: 20,
          archiveReason: `Filed away after ${ageDays} days with nothing started. Reopen it to keep it.`,
        };
      return {
        kind: RECOMMEND.BUILD,
        label: "Build it",
        why: own
          ? "Your own note on your own site; the project can take a run."
          : `${sourceWord(input.source)} on ${pageWord(input.page)}${times}; the project can take a run.`,
        runs: 1,
        priority: 40,
      };
    }

    case FEEDBACK_WORK_PHASE.STUCK:
      if (work.rerouteTo === "cloud")
        return {
          kind: RECOMMEND.CLOUD,
          label: "Run it in the cloud",
          why: "It is waiting for this computer, which is off; the cloud builder is online and nothing is lost by moving it.",
          runs: 1,
          priority: 50,
        };
      return {
        kind: RECOMMEND.RETRY,
        label: "Try again",
        why: "The agent went quiet without finishing. A fresh run usually completes; Loki picks a provider that can answer.",
        runs: 1,
        priority: 30,
      };

    case FEEDBACK_WORK_PHASE.FAILED: {
      const state = work.ship?.state;
      if (state === FIX_SHIP_STATE.PR_CLOSED)
        return {
          kind: RECOMMEND.FILE,
          label: "File away",
          why: "The change was closed without merging — somebody decided against it. Reopen if that was a mistake.",
          runs: 0,
          priority: 20,
          archiveReason: "Filed away: its pull request was closed without merging.",
        };
      return {
        kind: RECOMMEND.RETRY,
        label: "Try again",
        why: `${work.detail ?? "The attempt failed."} A fresh run on a provider that can answer is the usual fix.`,
        runs: 1,
        priority: 30,
      };
    }

    case FEEDBACK_WORK_PHASE.NEEDS_VERIFY: {
      const fix = work.ship ?? null;
      if (!fix) return null;
      const partial = /partial success/i.test(work.detail ?? "");
      switch (fix.state) {
        case FIX_SHIP_STATE.DEPLOYED: {
          if (partial)
            return {
              kind: RECOMMEND.RETRY,
              label: "Try again",
              why: "The change is live, but the agent itself said it only got part of the way. A second run finishes what it started.",
              runs: 1,
              priority: 35,
            };
          const look = fix.verify ?? null;
          // Loki read the page. Its verdict is the recommendation; the
          // evidence is the reason, so the owner can disagree from the card.
          if (look?.verdict === "looks_fixed")
            return {
              kind: RECOMMEND.CONFIRM,
              label: "Close it",
              why: `Loki checked ${pageWord(input.page)}: ${look.evidence}`,
              runs: 0,
              priority: 70,
            };
          if (look?.verdict === "not_visible")
            return {
              kind: RECOMMEND.RETRY,
              label: "Try again",
              why: `Loki checked ${pageWord(input.page)} and could not find the change: ${look.evidence}`,
              runs: 1,
              priority: 36,
            };
          return {
            kind: RECOMMEND.LOOK,
            label: "See it on the site",
            why: look
              ? `Live on ${pageWord(input.page)}. ${look.evidence} One look settles it.`
              : `Live on ${pageWord(input.page)}; Loki has not read the page yet. One look settles it.`,
            runs: 0,
            priority: 55,
          };
        }
        case FIX_SHIP_STATE.NO_EVIDENCE:
        case FIX_SHIP_STATE.PUSHED:
          return {
            kind: RECOMMEND.RETRY,
            label: "Try again",
            why: "The agent said it finished, but nothing reached the site. A fresh run that ends in a pull request is what ships.",
            runs: 1,
            priority: 30,
          };
        // Merged, deploying, or an open pull request: the machine finishes
        // these. Nothing to decide.
        default:
          return null;
      }
    }

    default:
      return null;
  }
}

function sourceWord(source: string | null): string {
  if (source === FEEDBACK_SOURCE.AI_REVIEW) return "Loki's own finding";
  if (source === FEEDBACK_SOURCE.SYNTHESIZER) return "A brief";
  return "A visitor's report";
}

/** What "Do all" would do, in numbers — said on the button, never discovered after. */
export function summarizeDecisions(recs: Recommendation[]): {
  total: number;
  runs: number;
  confirms: number;
  files: number;
  /** Live fixes only a person can settle — "Do all" leaves them for your eyes. */
  looks: number;
  /** Decisions the button can take (a CONNECT is a link, a LOOK is yours). */
  takeable: number;
} {
  let runs = 0;
  let confirms = 0;
  let files = 0;
  let looks = 0;
  let takeable = 0;
  for (const r of recs) {
    if (r.kind === RECOMMEND.LOOK) {
      looks += 1;
      continue;
    }
    if (r.kind === RECOMMEND.CONNECT) continue;
    takeable += 1;
    runs += r.runs;
    if (r.kind === RECOMMEND.CONFIRM) confirms += 1;
    if (r.kind === RECOMMEND.FILE) files += 1;
  }
  return { total: recs.length, runs, confirms, files, looks, takeable };
}

/** "Do all 12 · starts 4 runs, closes 3, files 5 away" — and what it leaves for your eyes. */
export function doAllLabel(s: ReturnType<typeof summarizeDecisions>): string {
  const parts = [
    s.runs ? `starts ${s.runs} ${s.runs === 1 ? "run" : "runs"}` : null,
    s.confirms ? `closes ${s.confirms}` : null,
    s.files ? `files ${s.files} away` : null,
  ].filter((p): p is string => p !== null);
  return `Do all ${s.takeable}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
}

/** The line beside "Do all" when some decisions are a person's to make. */
export function looksLine(s: ReturnType<typeof summarizeDecisions>): string | null {
  if (!s.looks) return null;
  return `${s.looks} ${s.looks === 1 ? "is" : "are"} live and need${s.looks === 1 ? "s" : ""} your eyes — Loki could not tell from the page.`;
}
