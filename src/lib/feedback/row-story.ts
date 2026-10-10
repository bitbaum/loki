/**
 * What a feedback row SAYS — the headline and the next step, in the owner's
 * words, derived once from the honest phase (work-phase.ts) and nothing else.
 *
 * Owner, 2026-10-10, on a phone: "It says live check it or needs you. It
 * doesn't explain why it needs me and what exactly I need to do … Watch
 * what? Where would I be taken? … I don't know what the star is, and I don't
 * know what that arrow is." The row showed a status WORD and a set of
 * buttons, and left the sentence between them — what happened, what is
 * wanted — for the reader to reconstruct. This module writes that sentence.
 *
 * Two lines per row, always:
 *   headline — what the state IS, as a plain statement ("The fix is live on
 *              /pricing.", "An agent is working on it — 4 min so far.",
 *              "The attempt failed: the agent ran out of quota.")
 *   next     — what happens now, or what is wanted of the reader ("Look at
 *              it, then say whether it worked." / "Nothing to do — it starts
 *              by itself."). Null when the headline already says it all.
 *
 * Pure: no DOM, no clock of its own. Tested in scripts/test/feedback-row-story.ts.
 */
import { FEEDBACK_WORK_PHASE, type FeedbackWorkView } from "@/lib/feedback/work-phase";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";
import { compactRelativeDate } from "@/lib/dates";

export type RowStory = {
  headline: string;
  next: string | null;
  /** Whose move it is — what the headline's colour says. */
  tone: "you" | "machine" | "done" | "quiet";
};

export type RowStoryInput = {
  work: FeedbackWorkView;
  /** The reported path, for "live on /pricing". */
  page: string | null;
  /** The project can take an agent run (a folder or a repository). */
  runnable: boolean;
  /** A run was ever linked — a done row with one has a walkthrough. */
  hadRun: boolean;
  resolvedAt: string | Date | null;
  archiveReason: string | null;
};

const pageWord = (page: string | null) => (page && page !== "/" ? page : "the home page");

/**
 * The phase layer's sentences name the OLD buttons ("Retry", "Resolve",
 * "Open Terminal", "Implement"). Said on the row they must name the moves
 * the row actually offers, or the sentence points at a button that is not
 * there. One mapping, applied to every borrowed line.
 */
export function inOwnersWords(text: string | null | undefined): string | null {
  if (!text) return null;
  return text
    .replace(/\bRetry\b/g, "Try again")
    .replace(/\bResolve\b/g, "Mark done")
    .replace(/\bOpen Terminal\b/g, "Watch in Terminal")
    .replace(/\bImplement\b/g, "Build it")
    .replace(/\bon Watch\b/g, "in its terminal");
}

export function rowStory(input: RowStoryInput, now = Date.now()): RowStory {
  const { work } = input;
  switch (work.phase) {
    case FEEDBACK_WORK_PHASE.NOT_STARTED:
      return input.runnable
        ? {
            headline: "Nobody has started on this.",
            next: "Build it, or file it away if it is not worth a run.",
            tone: "you",
          }
        : {
            headline: "This project has nowhere for an agent to work yet.",
            next: "Connect a repository or a folder, then build it.",
            tone: "you",
          };

    case FEEDBACK_WORK_PHASE.QUEUED: {
      if (work.detail?.startsWith("Behind "))
        return {
          headline: `Waiting its turn — ${work.detail[0].toLowerCase()}${work.detail.slice(1)}.`,
          next: "Nothing to do; it starts by itself.",
          tone: "machine",
        };
      return {
        headline:
          work.label === "Starting"
            ? "An agent is picking it up."
            : "Waiting for a builder to pick it up.",
        next:
          inOwnersWords(work.detail ?? work.stepSummary) ?? "Nothing to do; it starts by itself.",
        tone: "machine",
      };
    }

    case FEEDBACK_WORK_PHASE.WORKING: {
      const elapsed = work.since ? ` — ${elapsedWords(work.since, now)} so far` : "";
      return {
        headline: `An agent is working on it${elapsed}.`,
        next:
          inOwnersWords(work.detail ?? work.stepSummary) ?? "Nothing to do; you can watch it work.",
        tone: "machine",
      };
    }

    case FEEDBACK_WORK_PHASE.STUCK: {
      if (work.rerouteTo === "cloud")
        return {
          headline: "Stuck: this computer is offline, so the work has nowhere to run.",
          next: "Run it in the cloud — it starts now and nothing is lost.",
          tone: "you",
        };
      if (/sign in/i.test(work.label))
        return {
          headline: "The agent stopped at a sign-in prompt.",
          next: "Open its terminal and sign in; it carries on from there.",
          tone: "you",
        };
      if (work.label === "Never started" || work.label === "Not running")
        return {
          headline: "The attempt never started.",
          next: inOwnersWords(work.detail) ?? "Try again.",
          tone: "you",
        };
      if (/offline/i.test(work.detail ?? ""))
        return {
          headline: "Stuck: the builder that holds it is offline.",
          next: inOwnersWords(work.detail),
          tone: "you",
        };
      return {
        headline: "The agent went quiet and did not finish.",
        next: "Look at its terminal to see where it stopped, or try again.",
        tone: "you",
      };
    }

    case FEEDBACK_WORK_PHASE.FAILED: {
      const state = work.ship?.state;
      if (state === FIX_SHIP_STATE.PR_CLOSED)
        return {
          headline: "The change was closed without merging — nothing reached the site.",
          next: "Try again with a note, or mark it done if it was withdrawn on purpose.",
          tone: "you",
        };
      if (state === FIX_SHIP_STATE.DEPLOY_FAILED)
        return {
          headline: "Merged, but the deploy failed — the site still shows the old version.",
          next: "Try again, or look at the deploy to see what broke.",
          tone: "you",
        };
      if (work.label === "Never started")
        return {
          headline: "The attempt never started.",
          next: inOwnersWords(work.detail),
          tone: "you",
        };
      return {
        headline: "The attempt failed.",
        next: inOwnersWords(work.detail) ?? "Try again, on another provider if this one ran out.",
        tone: "you",
      };
    }

    case FEEDBACK_WORK_PHASE.NEEDS_VERIFY: {
      const fix = work.ship ?? null;
      const partial = /partial success/i.test(work.detail ?? "");
      const look = partial
        ? "Look closely — the agent reported only partial success — then say whether it worked."
        : "Look at it, then say whether it worked.";
      if (!fix)
        return {
          headline: "The agent finished — finding where its change is…",
          next: null,
          tone: "machine",
        };
      switch (fix.state) {
        case FIX_SHIP_STATE.DEPLOYED: {
          const seen = fix.verify ?? null;
          if (seen?.verdict === "looks_fixed")
            return {
              headline: `The fix is live on ${pageWord(input.page)} — Loki checked.`,
              next: `${seen.evidence} Close it, or look yourself first.`,
              tone: "you",
            };
          if (seen?.verdict === "not_visible")
            return {
              headline: `Live on ${pageWord(input.page)}, but Loki could not find the change.`,
              next: `${seen.evidence} Try again, or look yourself.`,
              tone: "you",
            };
          return {
            headline: `The fix is live on ${pageWord(input.page)}.`,
            next: seen ? `${seen.evidence} ${look}` : look,
            tone: "you",
          };
        }
        case FIX_SHIP_STATE.MERGED:
          return {
            headline: "The change is merged but not deployed yet.",
            next: `It lands with the next deploy; look at ${pageWord(input.page)} then.`,
            tone: "you",
          };
        case FIX_SHIP_STATE.DEPLOYING:
          return {
            headline: "The change is merged and deploying now.",
            next: "Live in a few minutes; nothing to do.",
            tone: "machine",
          };
        case FIX_SHIP_STATE.PR_OPEN:
          return {
            headline: fix.unverified
              ? "The agent says it wrote the change; GitHub could not be asked."
              : "The change is written and waiting to merge.",
            next: inOwnersWords(work.detail) ?? "Loki merges it when its checks pass.",
            tone: "machine",
          };
        case FIX_SHIP_STATE.PUSHED:
          return {
            headline: "The agent pushed a branch but opened no pull request.",
            next: "Open one from the branch, then it can merge and deploy.",
            tone: "you",
          };
        case FIX_SHIP_STATE.NO_EVIDENCE:
          return {
            headline: "The agent said it finished, but nothing reached the site.",
            next: fix.foreignPr
              ? "The pull request it named was already open before this run. Try again, or mark it done if no code change was needed."
              : "Try again, or mark it done if no code change was needed.",
            tone: "you",
          };
        default:
          return { headline: "The agent finished.", next: inOwnersWords(work.detail), tone: "you" };
      }
    }

    case FEEDBACK_WORK_PHASE.DONE: {
      const when = input.resolvedAt ? ` ${compactRelativeDate(input.resolvedAt)}` : "";
      return input.hadRun
        ? { headline: `Fixed — you confirmed it${when}.`, next: null, tone: "done" }
        : { headline: `Marked done${when}, without a run.`, next: null, tone: "done" };
    }

    case FEEDBACK_WORK_PHASE.ARCHIVED:
      return { headline: "Filed away.", next: input.archiveReason, tone: "quiet" };
  }
}

/** "4 min" / "1 h 05 min" since an ISO instant. Minutes only. */
function elapsedWords(sinceIso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(sinceIso)) / 60_000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}

/**
 * What each lens means, said under it — the owner should never have to
 * infer the page's vocabulary from its buttons.
 */
export const LENS_MEANING = {
  needsYou: "Each of these waits for one decision from you. The first line says which.",
  underWay: "Agents and deploys at work. Nothing for you to do — watch any of them live.",
  done: "Fixed and confirmed by you. See the walkthrough on the site, or share it.",
} as const;
