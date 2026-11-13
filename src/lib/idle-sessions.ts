/**
 * Which open agent sessions on the cloud builder have gone quiet long enough
 * to close.
 *
 * A session nobody is using still holds about 0.4 GB. On 2026-11-11 the box
 * had 27 open, most untouched for days, and ran out of memory. The limit on
 * how many may be open (agent-session-limit) stops the count growing; this
 * gives the memory back. Closing loses nothing: Claude resumes the
 * conversation from the Terminal's "where you left off".
 *
 * Quiet means no output and no input. An agent at work prints as it goes, and
 * one waiting on a person is closed only after the same long window.
 */
import { isShellTab } from "@/lib/shell-session";

export const AGENT_IDLE_CLOSE_HOURS_DEFAULT = 6;

/** LOKI_AGENT_IDLE_CLOSE_HOURS; 0 switches the closing off. */
export function agentIdleCloseMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LOKI_AGENT_IDLE_CLOSE_HOURS;
  const hours = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  const chosen = Number.isFinite(hours) && hours >= 0 ? hours : AGENT_IDLE_CLOSE_HOURS_DEFAULT;
  return chosen * 60 * 60 * 1000;
}

export interface OpenSession {
  tab: string;
  /** Last byte in or out; undefined when the executor does not track it. */
  lastActivityAt?: number;
}

/** Tabs to close now. Shells have their own lock and are never closed here. */
export function idleSessionsToClose(input: {
  channel: string | null | undefined;
  now: number;
  sessions: readonly OpenSession[];
  maxIdleMs: number;
}): string[] {
  if (input.channel !== "cloud" || input.maxIdleMs <= 0) return [];
  return input.sessions
    .filter(
      (s) =>
        !isShellTab(s.tab) &&
        typeof s.lastActivityAt === "number" &&
        input.now - s.lastActivityAt >= input.maxIdleMs,
    )
    .map((s) => s.tab);
}
