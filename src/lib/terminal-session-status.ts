import { isAwaitingUser } from "@/lib/session-state";
import type { FastProjectState } from "@/lib/control-fast-state";

/**
 * What a session is doing, in the four words a person running several at once
 * needs: is it busy, is it stuck on me, is it finished, or is it just open.
 *
 * Read from the same per-tab state Control streams (/api/control/stream), so
 * the terminal's tabs and Control can never disagree about a session.
 * Pure, so the rules are pinned without a browser.
 */
export type SessionStatus = "needs-you" | "working" | "done" | "idle";

export function sessionStatusOf(state: FastProjectState | null | undefined): SessionStatus | null {
  if (!state) return null;
  // A turn in progress outranks a handoff that said "blocked on you": the same
  // order Control's presenter uses (a stale handoff must not page anyone while
  // the agent is visibly working again).
  if (state.currentPrompt) return "working";
  if (isAwaitingUser(state.session)) return "needs-you";
  if (state.readyAt) return "done";
  return "idle";
}

/** How each status is said: to a screen reader, in a tooltip, in a notice. */
export const SESSION_STATUS_WORDS: Record<SessionStatus, string> = {
  "needs-you": "needs you",
  working: "working",
  done: "finished",
  idle: "open",
};

/**
 * Whether a change of status is news for someone looking at ANOTHER session:
 * it just finished, or it just started waiting on them. Starting work, or
 * staying the same, is not worth interrupting anyone for.
 */
export function isNewsworthy(
  before: SessionStatus | null | undefined,
  after: SessionStatus | null | undefined,
): boolean {
  if (!after || before === after || !before) return false;
  return after === "needs-you" || (after === "done" && before === "working");
}

/** Fewer quiet sessions than this are simply listed; folding three rows is busywork. */
const QUIET_FOLD_MIN = 4;

const ATTENTION: Record<SessionStatus, number> = { "needs-you": 0, working: 1, done: 2, idle: 3 };

/**
 * The session list in the order a person needs it, and what can wait.
 *
 * The phone's picker listed every open session in the order it was opened: 27
 * rows, "Loki 2" to "Loki 15", with the three that needed the owner somewhere
 * among them (2026-11-11). `first` is what is worth reading now: sessions
 * waiting on the person, then working, then finished, plus the one in use.
 * `quiet` is the rest (open, nothing happening), shown on request.
 */
export function orderSessions<T extends { id: string; status?: SessionStatus | null }>(
  tabs: readonly T[],
  activeId: string | null,
): { first: T[]; quiet: T[] } {
  const rank = (t: T) => (t.status ? ATTENTION[t.status] : ATTENTION.idle);
  const sorted = tabs
    .map((tab, index) => ({ tab, index }))
    .sort((a, b) => rank(a.tab) - rank(b.tab) || a.index - b.index)
    .map(({ tab }) => tab);
  const isQuiet = (t: T) => t.id !== activeId && rank(t) === ATTENTION.idle;
  const quiet = sorted.filter(isQuiet);
  if (quiet.length < QUIET_FOLD_MIN) return { first: sorted, quiet: [] };
  return { first: sorted.filter((t) => !isQuiet(t)), quiet };
}
