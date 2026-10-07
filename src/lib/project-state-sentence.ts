/**
 * One sentence per project, in the operator's words: what is happening, and
 * whether it is live or waiting on them.
 *
 * The facts already existed. The build status knew whether an agent was
 * working; the run ledger knew the outcome; the fix ledger knew whether the
 * change had merged and deployed. The page read the first two and said "work
 * reached the repo" — true, and not the answer. The person who asked for the
 * change wants to know one thing: is it live? The vocabulary of pull
 * requests, CI and auto-merge is how the system gets there, not what it
 * owes the reader (operator, 2026-10-07: "is solving the problem feeling like
 * magic? if not, what is stopping it").
 *
 * Rules:
 *  - say what is KNOWN, from the sources the page loads, and no more;
 *  - end on the outcome ("live at skif.ch", "waiting on you"), never on the
 *    mechanism ("PR #43 CI pending");
 *  - `waitingOnYou` is true only when nothing will change until the operator
 *    acts. A change in review goes live by itself; that is not waiting on
 *    anyone.
 */
import type { BuildStatus, LastAttempt } from "@/lib/project-build-status";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";
import { formatDurationMinutes, timeAgo } from "@/lib/dates";

export type ProjectStateSentence = {
  /** The one line. Short, present tense, no identifiers. */
  headline: string;
  /** The second line: when, and what it rests on. */
  detail: string;
  tone: "working" | "live" | "waiting" | "quiet";
  /** Nothing moves until the operator does something. */
  waitingOnYou: boolean;
};

const OUTCOME_VERB: Record<string, string> = {
  success: "finished",
  partial: "finished partially",
  user_abort: "was stopped",
  error: "failed",
  hang: "hung",
  timeout: "timed out",
};

/** "skif.ch" from "https://skif.ch/" — the address as a person says it. */
export function siteName(liveUrl: string | null | undefined): string | null {
  if (!liveUrl) return null;
  try {
    return new URL(liveUrl).host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function projectStateSentence(
  status: BuildStatus,
  opts: { liveUrl?: string | null } = {},
): ProjectStateSentence {
  const ago = timeAgo;
  switch (status.kind) {
    case "building":
      return {
        headline: "Building now",
        detail:
          [status.label, status.sinceMs != null ? `started ${ago(status.sinceMs)}` : null]
            .filter(Boolean)
            .join(" · ") || "An agent is working on this project.",
        tone: "working",
        waitingOnYou: false,
      };
    case "queued":
      return {
        headline: "Starting up",
        detail: `Sent ${ago(status.sinceMs)}. Waiting for a builder to pick it up.`,
        tone: "working",
        waitingOnYou: false,
      };
    case "stalled":
      return {
        headline: `Sent ${ago(status.sinceMs)}, but nobody picked it up`,
        detail: "Nothing was recorded for that request, so starting again is safe.",
        tone: "waiting",
        waitingOnYou: true,
      };
    case "idle":
      return idleSentence(status.last, opts.liveUrl ?? null, ago);
  }
}

function idleSentence(
  last: LastAttempt | null,
  liveUrl: string | null,
  ago: (ms: number) => string,
): ProjectStateSentence {
  if (!last) {
    return {
      headline: "Nothing built yet",
      detail: "Describe what you want and an agent starts on it.",
      tone: "quiet",
      waitingOnYou: true,
    };
  }
  const when = ago(last.finishedAtMs);
  const site = siteName(liveUrl);
  const ship = last.shipping;
  // The ledger outranks the run's own grade: it looked AFTER the run closed.
  if (ship) {
    switch (ship.state) {
      case FIX_SHIP_STATE.DEPLOYED:
        return {
          headline: site ? `Live at ${site}` : "Live",
          detail: `The last change is merged and deployed — finished ${when}.`,
          tone: "live",
          waitingOnYou: false,
        };
      case FIX_SHIP_STATE.DEPLOYING:
        return {
          headline: "Going live",
          detail: `The last change is merged; ${ship.deployName ?? "the deploy"} is running now.`,
          tone: "working",
          waitingOnYou: false,
        };
      case FIX_SHIP_STATE.DEPLOY_FAILED:
        return {
          headline: "Merged, but not live",
          detail: `${ship.deployName ?? "The deploy"} failed after the change merged ${when}. It needs a look.`,
          tone: "waiting",
          waitingOnYou: true,
        };
      case FIX_SHIP_STATE.MERGED:
        return {
          headline: "Merged, not deployed",
          detail: `The change merged ${when}, but no deploy ran on it.`,
          tone: "waiting",
          waitingOnYou: true,
        };
      case FIX_SHIP_STATE.PR_OPEN:
        return {
          headline: "In review — goes live by itself",
          detail: `The change is waiting on its checks (finished ${when}). Nothing for you to do unless they fail.`,
          tone: "working",
          waitingOnYou: false,
        };
      case FIX_SHIP_STATE.PR_CLOSED:
        return {
          headline: "Change was dropped",
          detail: `The last change was closed without going live, ${when}.`,
          tone: "waiting",
          waitingOnYou: true,
        };
      // no_evidence and pushed add nothing the run's own grade does not say.
    }
  }
  const verb = OUTCOME_VERB[last.outcome] ?? last.outcome;
  const saved = last.landed ? "changes were saved" : "nothing was saved";
  const took = formatDurationMinutes(last.durationMinutes);
  if (last.outcome === "success") {
    return {
      headline: last.landed ? "Done, not yet live" : "Done — nothing to ship",
      detail: `The last run finished ${when} after ${took} — ${saved}.`,
      tone: last.landed ? "waiting" : "quiet",
      waitingOnYou: true,
    };
  }
  return {
    headline: "Stopped before it was done",
    detail: `The last attempt ${verb} ${when} after ${took} — ${saved}.`,
    tone: "waiting",
    waitingOnYou: true,
  };
}
