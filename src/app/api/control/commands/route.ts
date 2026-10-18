import { type NextRequest, NextResponse } from "next/server";
import { claimNextPendingCommand } from "@/db/queries/pending-commands";
import { getApiUserId } from "@/lib/session";
import { RUNNER_LONG_POLL_MS } from "@/lib/constants/runner";
import type { RunnerChannel } from "@/db/schema/pending-commands";
import { z } from "@/lib/api/route-helpers";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";
import { getRuntimeSnapshot } from "@/db/queries/runtime-snapshots";
import { builderBehind } from "@/lib/builder-presence";
import { claimableTypes } from "@/lib/runner-update-hold";

/**
 * Is this account's cloud builder behind the deploy? Read from its own
 * heartbeat, remembered for a short while: the runner polls every two
 * seconds and the answer changes once per deploy.
 */
const BEHIND_TTL_MS = 30_000;
const behindCache = new Map<string, { behind: boolean; at: number }>();
async function cloudBuilderBehind(userId: string): Promise<boolean> {
  const hit = behindCache.get(userId);
  if (hit && Date.now() - hit.at < BEHIND_TTL_MS) return hit.behind;
  const snapshot = await getRuntimeSnapshot(userId, "cloud").catch(() => null);
  const behind = builderBehind(snapshot?.runnerVersion);
  behindCache.set(userId, { behind, at: Date.now() });
  return behind;
}

const Channel = z.enum(BUILDER_CHANNELS);

// Runner polls this to claim the next pending command.
// Auth: Bearer (env token or ck_* agent token) OR browser session.
// ?wait=N (seconds, max RUNNER_LONG_POLL_SECONDS): long-poll — holds until a
// command arrives or wait expires. Cap lives in @/lib/constants/runner so the
// desktop poller's request shape and this server-side ceiling can't drift.
export async function GET(request: NextRequest) {
  // Resolve the user once. getApiUserId does the cookie session FIRST — via
  // resolveSessionUserId, which recovers an orphaned JWT (valid token, no user
  // row after a reseed) by verified email instead of polling under a dangling id
  // — THEN falls back to the runner's Bearer token. Per-user either way: a token
  // must never claim another account's commands, even on a shared host.
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userIds = [userId];

  const requested = request.nextUrl.searchParams
    .get("types")
    ?.split(",")
    .map((type) => type.trim())
    .filter(Boolean);
  const channelParam = Channel.safeParse(request.nextUrl.searchParams.get("channel"));
  // Legacy-desktop compat: a poller that declares NO channel is an older
  // packaged Fleet Runner (<= 0.8.9, built before channel declaration) —
  // always a user-owned LOCAL machine. Treat it as "local" so channel-pinned
  // dispatches (projectPreferredChannel) still reach it. The shared cloud
  // builder is provisioned by install-box-runner.sh, which has always set
  // LOKI_RUNNER_PRESENCE_CHANNEL=cloud — it never polls paramless.
  const runnerChannel: RunnerChannel = channelParam.success ? channelParam.data : "local";
  // A cloud builder behind the deploy starts no new work until it restarts
  // (lib/runner-update-hold): the work-starters stay queued for the new code.
  const holding = runnerChannel === "cloud" && (await cloudBuilderBehind(userId));
  const types = claimableTypes(requested, holding);

  // Long-poll: hold the request until a command arrives or the wait expires.
  const waitMs = Math.min(
    parseInt(request.nextUrl.searchParams.get("wait") ?? "0", 10) * 1000,
    RUNNER_LONG_POLL_MS,
  );
  if (waitMs > 0) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline && !request.signal.aborted) {
      const command = await claimNextPendingCommand(userIds, types, runnerChannel);
      if (command) return NextResponse.json({ command });
      await new Promise<void>((res) => setTimeout(res, 100));
    }
    return NextResponse.json({ command: null });
  }

  const command = await claimNextPendingCommand(userIds, types, runnerChannel);
  return NextResponse.json({ command: command ?? null });
}
