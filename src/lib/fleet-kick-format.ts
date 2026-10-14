import type { AutoInjectMode } from "@/config/beacon";
import { EXECUTOR_COPY } from "@/config/executor-copy";

/** Omitted means all; an explicit empty selection means none. */
export function normalizeKickScope(keys: string[] | undefined): Set<string> | null {
  return keys === undefined ? null : new Set(keys.map((key) => key.toLowerCase()));
}

export type FleetKickReplyDetail = {
  projectKey: string;
  outcome: "kicked" | "skipped";
  reason?: string;
};

export type FleetKickReplyResult = {
  runnerConnected: boolean;
  fleetMode: AutoInjectMode;
  kicked: number;
  activeBefore: number;
  details: FleetKickReplyDetail[];
  message: string;
};

/** Prefer agents that reported ready — they're waiting for the next instruction. */
export function sortProjectsForKick(names: string[], readyKeys: Set<string>): string[] {
  return [...names].sort((a, b) => {
    const ar = readyKeys.has(a.toLowerCase()) ? 0 : 1;
    const br = readyKeys.has(b.toLowerCase()) ? 0 : 1;
    if (ar !== br) return ar - br;
    return a.localeCompare(b);
  });
}

export function formatFleetKickReply(result: FleetKickReplyResult): string {
  const lines = [result.message];
  const kickedNames = result.details.filter((d) => d.outcome === "kicked").map((d) => d.projectKey);
  const skipped = result.details.filter((d) => d.outcome === "skipped");
  if (kickedNames.length > 0) {
    lines.push("", "**Started:**", ...kickedNames.map((n) => `- ${n}`));
  }
  if (skipped.length > 0) {
    const reasonLabel = (reason: string | undefined) => {
      if (reason === "no_path") return "needs a local path";
      if (reason === "pending_command") return "already queued";
      if (reason === "busy") return "already working";
      if (reason === "concurrency_cap") return "concurrency cap";
      if (reason === "blocked") return "blocked";
      return reason ?? "not eligible";
    };
    lines.push(
      "",
      "**Skipped:**",
      ...skipped.slice(0, 8).map((d) => `- ${d.projectKey}: ${reasonLabel(d.reason)}`),
    );
    if (skipped.length > 8) lines.push(`- ...and ${skipped.length - 8} more`);
  }
  if (!result.runnerConnected && result.kicked > 0) {
    lines.push("", EXECUTOR_COPY.queuedWhenOfflineLong);
  }
  if (result.kicked > 0) {
    lines.push("", EXECUTOR_COPY.fleetKick.watchControl);
  }
  return lines.join("\n");
}
