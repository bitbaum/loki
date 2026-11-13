/**
 * Where this server keeps its one AI usage log.
 *
 * Other apps on the box get AI_USAGE_DIR from /opt/fleet/env through their
 * launch script. Loki's own launch script predates that file, so on
 * 2026-11-13 Loki neither wrote to the log nor could read it, and the card
 * built to show the whole server said the server was not writing one. The
 * directory is a fact about the machine: when the variable is unset and the
 * box's directory exists, that is the log.
 */
import { existsSync } from "node:fs";

export const BOX_USAGE_DIR = "/opt/fleet/ai-usage";

export function fleetUsageDir(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const set = env.AI_USAGE_DIR?.trim();
  if (set) return set;
  return exists(BOX_USAGE_DIR) ? BOX_USAGE_DIR : null;
}

/**
 * At boot: make Loki's own calls land in the log too. ai-kit reads
 * AI_USAGE_DIR and names the app from AI_APP_ID; neither is overwritten.
 */
export function adoptFleetUsageLog(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): void {
  const dir = fleetUsageDir(env, exists);
  if (!dir) return;
  if (!env.AI_USAGE_DIR?.trim()) env.AI_USAGE_DIR = dir;
  if (!env.AI_APP_ID?.trim()) env.AI_APP_ID = "LOKI";
}
