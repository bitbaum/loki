import type { RunnerChannel } from "@/db/schema/pending-commands";

/**
 * A fresh one-off session (inject `session: "fresh"`) is closed when its run
 * closes, however it closes.
 *
 * It was closed only when its own handoff closed the run. A one-off that never
 * reported, was reaped, ended on a refused ack or a runner restart kept its
 * agent open in its lane: free to go on to something else, and holding one of
 * the project's lanes and one of the builder's agent sessions until somebody
 * closed it by hand.
 *
 * Called from notifyRunClosed, which every close path calls once per closed
 * run (the funnel, the reaper, refusals, the runner's own reports).
 */

/** The tab to close and the builder it is on, for a closed one-off run. Pure. */
export function oneOffTabToClose(
  payload: unknown,
): { tab: string; channel?: RunnerChannel } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { oneOff?: unknown; sessionTab?: unknown; oneOffChannel?: unknown };
  if (p.oneOff !== true) return null;
  if (typeof p.sessionTab !== "string" || !p.sessionTab.includes("~")) return null;
  const channel =
    p.oneOffChannel === "cloud" || p.oneOffChannel === "local" ? p.oneOffChannel : undefined;
  return { tab: p.sessionTab, ...(channel ? { channel } : {}) };
}

/**
 * The builder to close a one-off on: the one its dispatch command names now,
 * else the one recorded when it was queued. A queued dispatch can be moved to
 * the other builder (the one-tap reroute rewrites the command's channel), and
 * a close sent to the first one would answer "nothing to close" and leave the
 * session running on the second. Pure.
 */
export function closeChannelFor(
  commandChannel: unknown,
  recorded: RunnerChannel | undefined,
): RunnerChannel | undefined {
  return commandChannel === "cloud" || commandChannel === "local" ? commandChannel : recorded;
}

/** Queue close_tab for a closed one-off run. Best effort; never throws. */
export async function closeOneOffSession(run: {
  userId: string;
  payload: unknown;
}): Promise<boolean> {
  const target = oneOffTabToClose(run.payload);
  if (!target) return false;
  try {
    const { enqueueTabCommand, getCommandById } = await import("@/db/queries/pending-commands");
    const commandId = (run.payload as { commandId?: unknown }).commandId;
    const command =
      typeof commandId === "string" ? await getCommandById(commandId).catch(() => null) : null;
    const channel = closeChannelFor(
      command && command.userId === run.userId
        ? (command.payload as { channel?: unknown } | null)?.channel
        : undefined,
      target.channel,
    );
    await enqueueTabCommand(run.userId, "close_tab", {
      tab: target.tab,
      ...(channel ? { channel } : {}),
    });
    return true;
  } catch (err) {
    console.error("[one-off-close] close_tab failed:", err);
    return false;
  }
}
