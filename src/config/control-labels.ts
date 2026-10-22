/**
 * SSOT for /control + /activity prompt vocabulary (Phase 3 naming pass).
 *
 * Three distinct surfaces — keep labels unambiguous:
 * - Saved prompts (/prompts): reusable templates you author
 * - Up next (queue): waiting to dispatch on this project
 * - Recent dispatches / paste from history: already sent to an agent
 * - Prompt library: Loki starter templates on the project card
 */

/** User-authored templates on /prompts — the section above Loki's library. */
export const SAVED_PROMPTS_TITLE = "Your prompts";

/** Loki featured templates on the project card */
export const PROMPT_LIBRARY_TITLE = "Prompt library";

/** Per-project queue — autopilot drains head-first */
export function promptQueueHeading(count: number): string {
  return `Up next · ${count}`;
}

/** Composer hint when the queue is empty */
export const PROMPT_QUEUE_EMPTY_HINT = "Alt+Enter while typing to add to the queue";

/** Collapsed activity drawer — dispatches in the last 24h (up to 5 shown) */
export const RECENT_DISPATCHES_TITLE = "Recent dispatches";

/** Chip row — fills the composer from past dispatches */
export const PASTE_FROM_HISTORY_TITLE = "Paste from history";

/** Deep link from project card → /activity */
export const ALL_ACTIVITY_LINK = "All activity →";

/** Collapsed activity section toggle */
export const PROJECT_ACTIVITY_TITLE = "Activity";

/** Chip on collapsed activity row. The exact count is already in hand (the
 *  ledger fetches up to PROJECT_ACTIVITY_FETCH_CAP per project) — clamping at
 *  "5+" threw away a number we had: 7 real dispatches today read as "5+". Only
 *  the FETCH cap is a genuine unknown, so only it gets a "+". */
export const PROJECT_ACTIVITY_FETCH_CAP = 8;
export function recentDispatchChip(count: number): string {
  return count >= PROJECT_ACTIVITY_FETCH_CAP
    ? `${PROJECT_ACTIVITY_FETCH_CAP}+ dispatched`
    : `${count} dispatched`;
}

/** Prompt composer footer hints (local auto-send gate, not fleet autopilot) */
export const COMPOSER_HINT = {
  enterSends: "Enter sends · Alt+Enter queues (or sends now if idle)",
  autoSendPaused: "Auto-send paused for this project",
  autoSendWhileTyping: "Auto-send pauses while you type",
  autoSendReady: "Auto-send ready when the agent waits",
} as const;
