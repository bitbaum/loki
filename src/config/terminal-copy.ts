/**
 * SSOT for the words a person reads inside an open session (/terminal): the
 * line above the message box, the fold under a message Loki sent, and the
 * session sheet's agent switch.
 *
 * "Waiting" is kept for one meaning only: the session is waiting for YOU —
 * the word Home and the session list use (src/lib/session-list.ts,
 * src/lib/running-now.ts). The live line used to say "Waiting for the agent"
 * while the agent was busy, and the owner could not tell "it is busy" from
 * "it needs me" (audit, 2026-11-12).
 */
export const TERMINAL_CHAT_COPY = {
  /** The agent is mid-turn; a spinner and the turn clock sit beside it. */
  working: (agent: string) => `${agent} is working`,
  /** Mid-turn, but nothing new for a while. */
  quiet: "No recent update from the agent",
  /** The agent answered and nothing is running: it is the person's turn. */
  yourTurn: "Done. Waiting for your reply",
  reconnecting: "Reconnecting to the session…",
  stopped: "Stopped",
} as const;

/**
 * A message Loki typed into the session on the owner's behalf (a task, a
 * feedback fix). The bubble shows the task; the fold holds the whole text the
 * agent received. "Dispatch details" named Loki's plumbing, not the thing.
 */
export const LOKI_SENT_COPY = {
  byline: "Sent by Loki",
  fold: "Full instructions Loki sent",
} as const;

/** The session sheet's "switch this session to another agent". */
export const AGENT_SWITCH_COPY = {
  section: "Switch this session to…",
  /** The armed second tap: says what stops. */
  confirm: (to: string, from: string | null) =>
    from ? `Switch to ${to}? ${from} stops here` : `Switch to ${to}?`,
  switching: "Switching…",
  noSession: "Open a session first.",
  noProject: "This session has no project, so it can't switch.",
} as const;

/** The session sheet's "Runs on" row for the owner's own computer. */
export const RUNS_ON_COPY = {
  machineOffline: "Offline: open Fleet Runner on it",
} as const;
