/**
 * What happens to a dispatch whose project already has a run open.
 *
 * Two answers existed, and which one a caller got depended on a server flag
 * nobody on the calling side could see. With LOKI_PARALLEL_DISPATCH on, every
 * dispatch to a busy project forked a parallel lane: its own tab, worktree and
 * a NEW agent session. That is right for a person pressing Implement, who is
 * standing there and whose fix has nothing to do with the run ahead of it. It
 * is wrong for a message TO the project's session: on 2026-11-12 a message
 * sent to orangecat while run 9e3658d9 was open started a second agent that
 * had none of the conversation it was written for, instead of waiting its turn
 * as inject-core's projectBusy comment promises.
 *
 * So the caller says which it wants, and the default is the promise: a busy
 * project queues, first in, first out, behind the open run. A lane is given
 * only to a caller that asked for one.
 */
export type WhenBusy = "queue" | "lane";

export type BusyPlacement =
  /** Nothing is ahead of it: dispatch as usual. */
  | "now"
  /** Wait for the open run; the runner claims it when the project frees. */
  | "queue"
  /** Ask for a parallel lane; the queue still takes it when none is free. */
  | "lane";

export function busyPlacement(input: {
  projectBusy: boolean | undefined;
  whenBusy: WhenBusy | undefined;
  /** A lane is a worktree of a checkout: without a directory there is none. */
  hasDir: boolean;
  hasProjectKey: boolean;
}): BusyPlacement {
  if (!input.projectBusy) return "now";
  if (input.whenBusy !== "lane") return "queue";
  return input.hasDir && input.hasProjectKey ? "lane" : "queue";
}
