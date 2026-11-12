/**
 * How many agent sessions the cloud builder keeps open at once.
 *
 * On 2026-11-11 the box had 27 agent CLIs open, each holding about 0.4 GB,
 * beside 21 live sites on 16 GB. Memory ran out and every site went down.
 * Nothing limited agent sessions; only plain shells had a cap
 * (SHELL_MAX_OPEN). The server refuses the next one in words, and the runner
 * refuses it again, since the server's count can be one heartbeat old.
 *
 * Only the cloud builder: a person's own computer is theirs to fill.
 */
import { isShellTab } from "@/lib/shell-session";

/**
 * Five sessions. Eight was sized at 0.4 GB a session; a sealed session
 * (gVisor) measures about 1 GiB (2026-11-12: the builder held 6.3 to 8.3 GiB
 * with seven or eight open, the box had 0.6 GiB left and the kernel had
 * stopped 37 processes for memory, live sites and the gateway among them).
 * The box is 15 GiB; sites, databases and one deploy build need about 9 of it.
 * LOKI_AGENT_MAX_OPEN raises it where there is room.
 */
export const AGENT_MAX_OPEN_DEFAULT = 5;

/** LOKI_AGENT_MAX_OPEN on the runner or the server, else the default. */
export function agentMaxOpen(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.LOKI_AGENT_MAX_OPEN ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : AGENT_MAX_OPEN_DEFAULT;
}

/** Open agent sessions among a runner's open tabs (shells have their own cap). */
export function openAgentCount(openTabs: readonly string[]): number {
  return openTabs.filter((tab) => !isShellTab(tab)).length;
}

/**
 * Why a new session is refused, or null when there is room. Re-opening a tab
 * that is already open adds nothing and is never refused.
 */
export function agentLimitRefusal(input: {
  channel: string | null | undefined;
  tab: string;
  openTabs: readonly string[];
  max?: number;
}): string | null {
  if (input.channel !== "cloud") return null;
  const tab = input.tab.toLowerCase();
  if (input.openTabs.some((open) => open.toLowerCase() === tab)) return null;
  const max = input.max ?? agentMaxOpen();
  if (openAgentCount(input.openTabs) < max) return null;
  return `${max} agent sessions are already open on the cloud builder, which is as many as it runs at once. Close one you are not using, then try again.`;
}
