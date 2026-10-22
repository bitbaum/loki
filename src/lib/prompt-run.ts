/**
 * How a prompt from the library is run, and what the Run sheet says after.
 * Pure, so the words are pinned by scripts/test/prompts-page.ts.
 *
 * A prompt is for one of two workers. Most of the library is work an agent
 * does INSIDE a project — scan its code, fix its tests, ship it — and asking
 * Loki's chat to "find all TODO comments" gets an essay about TODO comments,
 * because the chat cannot open the repository. The personal prompts ("Daily
 * wrap-up", "Weekly build review") are the other way round: they read Loki's
 * own records across every project, which is what the chat is for. The sheet
 * leads with the right one as its single Run button and keeps the other one
 * line below, so a person never has to work out which of two equal buttons
 * means what (owner, 2026-10-21: two side-by-side actions, each with a
 * paragraph explaining itself).
 */
import type { DispatchLiveStatus } from "@/lib/dispatch-status";

export type PromptWorker = "agent" | "loki";

export function promptWorker(template: { category: string }): PromptWorker {
  return template.category === "personal" ? "loki" : "agent";
}

/**
 * The one sentence under the Run button once a prompt has gone to a project.
 * It used to be the queue's own words — "Dispatch failed — no running agent
 * for 'substrata' on this runner — dispatch to start one" — under a "Watch"
 * pill. Now it is what happened, said the way a person would, and the link
 * beside it (Watch it work) is where the detail lives.
 */
export function sendResultLine(input: {
  /** The send's recorded state, once known. */
  status: DispatchLiveStatus | null;
  /** The send queued with no builder online to take it. */
  waitingForBuilder?: boolean;
  project: string;
}): { text: string; failed: boolean } {
  const p = input.project;
  switch (input.status) {
    case "working":
      return { text: `An agent is working on it in ${p}.`, failed: false };
    case "delivered":
      return { text: `The agent in ${p} has it and is working.`, failed: false };
    case "completed":
      return { text: `Done in ${p}.`, failed: false };
    case "partial":
      return { text: `Partly done in ${p}. Watch it to see what is left.`, failed: false };
    case "stopped":
      return { text: `Stopped before it finished in ${p}.`, failed: false };
    case "unconfirmed":
      return { text: `Sent to ${p}. Loki has not heard back from the agent yet.`, failed: false };
    case "failed":
      return { text: `It could not start in ${p}. Try again.`, failed: true };
    case "queued":
    case null:
    default:
      return input.waitingForBuilder
        ? { text: `Sent. It starts in ${p} as soon as a builder is online.`, failed: false }
        : { text: `Sent to ${p}. An agent starts on it in a moment.`, failed: false };
  }
}
