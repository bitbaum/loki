// UI banner display windows — how long each state banner stays visible after detection.
// Must be kept in sync with the /tmp sentinel file TTLs in the bash hooks.
export const READY_WINDOW_S = 600; // 10 min — "Agent finished" banner
export const CLOSED_WINDOW_S = 3600; // 1 hour — "Session closed" banner
export const CLOSING_WINDOW_S = 1800; // 30 min — "Closing session…" banner
// Projects with recent ready/closing/closed activity are considered "active" for display.
// Must be long enough to survive a brief idle gap between sessions on the same project.
export const ACTIVE_WINDOW_S = 300; // 5 min — active vs idle split in control presenter
export const DEFAULT_BEACON_COUNTDOWN_S = 12; // fallback when settings file is absent — must match Python COUNTDOWN_SECONDS
export const MIN_BEACON_COUNTDOWN_S = 5; // shortest allowed beacon countdown
export const MAX_BEACON_COUNTDOWN_S = 300; // longest allowed beacon countdown (5 minutes)
/** New-user autopilot policy. After the 2026-06-11 collapse the choice is
 *  binary — "on" defaults to true so new users get the fire-when-ready
 *  behavior immediately (still safety-gated by status:working, blockers,
 *  health). Users who want to dispatch every prompt manually toggle off. */
export const DEFAULT_AUTO_INJECT_MODE = "on" as const;

/** Max projects fleet-kick will start in one batch. Autopilot keeps filling
 *  slots as agents finish — this prevents 18 simultaneous cold starts. */
export const MAX_CONCURRENT_BUILDING = 3;

// Fleet query windows — used by getFleetSummary (today.ts) to classify agent states from DB only.
// PROMPT_RUNNING_WINDOW_S: a started prompt older than this is considered stale (crashed without cleanup).
// Uses READY_WINDOW_S for the "waiting" cutoff so both the UI banner and the summary pill agree.
export const PROMPT_RUNNING_WINDOW_S = 14400; // 4 hours

// How long a sentinel file or DB event remains valid as a source of lifecycle state.
// Intentionally much larger than the UI display windows so DB state can survive a banner dismiss.
export const SENTINEL_VALIDITY_S = 86400; // 24 hours

// Grace window after a locally-dispatched prompt before we trust the /proc scan
// to declare "no agent is running". Covers the latency between writing the
// current-prompt sentinel and the agent process actually appearing in /proc
// (a shell launching `claude`/`codex`/etc. takes a couple seconds). Past this,
// a locally-written ("inject") sentinel with no matching agent process means
// the agent exited or never launched — the prompt is stale, not "Working".
export const AGENT_ABSENT_GRACE_S = 20; // 20s — agent boot/exec latency cushion

/** Returns true when a unix-seconds timestamp is non-null and falls within the given window. */
export function withinWindow(ts: number | null, nowS: number, windowS: number): boolean {
  return ts !== null && nowS - ts < windowS;
}

/** Extract the short health label from verbose agent output like "GOOD — deployed; all tests pass" */
export function getHealthShort(health: string): string {
  return health
    .split(/\s*[,—–]\s*/)[0]
    .trim()
    .toLowerCase();
}

/** Returns true for health short-labels that represent a problem needing attention. */
export function isHealthPoor(short: string): boolean {
  return short === "degraded" || short === "critical";
}

// Maps the AgentPrompt.style field → Tailwind class for consistent chip rendering.
// Used by ReadyBanner (control panel) and the beacon popup — single SSOT for chip appearance.
// Note: the beacon's action chips and the control panel's orchestration buttons (control-intents.ts)
// are intentionally separate systems: beacon injects text into Claude; orchestration dispatches
// a workflow via API. Their keys overlap but their execution paths differ.
export const PROMPT_STYLE: Record<string, string> = {
  primary: "ui-btn-ready-primary",
  action: "ui-btn-ready-action",
  more: "ui-btn-ready-more",
};
