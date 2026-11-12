/**
 * A bot following a run holds the run's session as a viewer for a while.
 *
 * The runner streams a session's conversation only while someone watches it
 * (desktop/src/main/transcript-streamer.ts: started by peek_start, stopped by
 * peek_stop), and the server keeps only what was streamed (lib/sse-bus,
 * lastTranscript). A bot that sends a task and reads the answer a minute
 * later was not watching in between, so the copy was empty, or worse, an old
 * conversation from the last time a person looked. A one-off session closes
 * when it reports, so by the time the run settled there was nothing left to
 * ask for.
 *
 * A watch is the bot's way of looking: it joins as a viewer exactly as the
 * Terminal page does, for a bounded time, and leaves on its own. Joining
 * again extends it. In-process, like the viewer counts it rides on (one box
 * instance; see lib/sse-bus).
 */
import { APP_SLUG } from "@/config/brand";
import { enqueuePeekCommand } from "@/db/queries/pending-commands";
import type { BuilderChannel } from "@/lib/constants/statuses";
import { addPeekViewer, removePeekViewer } from "@/lib/sse-bus";

/** The longest a watch lasts without being renewed. */
export const WATCH_MAX_SECONDS = 300;

type Watch = { timer: ReturnType<typeof setTimeout>; until: number };

const KEY = `$$${APP_SLUG}_orangecat_watches`;
if (!(globalThis as Record<string, unknown>)[KEY]) {
  (globalThis as Record<string, unknown>)[KEY] = new Map<string, Watch>();
}
const watches = (globalThis as Record<string, unknown>)[KEY] as Map<string, Watch>;

function watchKey(userId: string, tab: string, channel?: BuilderChannel): string {
  return `${userId}:${channel ?? "any"}:${tab.toLowerCase()}`;
}

/** Seconds, clamped to 1..WATCH_MAX_SECONDS. */
export function watchSeconds(seconds: number): number {
  return Math.max(1, Math.min(WATCH_MAX_SECONDS, Math.floor(seconds) || 1));
}

/**
 * Watch a session for `seconds`, or extend a watch already held. Returns the
 * time the watch ends. Best effort: a command that cannot be queued leaves
 * the conversation unstreamed, which a later read reports as it finds it.
 */
export async function watchTab(
  userId: string,
  tab: string,
  seconds: number,
  channel?: BuilderChannel,
  now = Date.now(),
): Promise<number> {
  const key = watchKey(userId, tab, channel);
  const ms = watchSeconds(seconds) * 1000;
  const until = now + ms;
  const command = { tab, ...(channel ? { channel } : {}) };
  const release = () => {
    watches.delete(key);
    if (removePeekViewer(userId, tab, channel)) {
      void enqueuePeekCommand(userId, "peek_stop", command).catch(() => {});
    }
  };

  const held = watches.get(key);
  if (held) {
    clearTimeout(held.timer);
    held.until = Math.max(held.until, until);
    held.timer = setTimeout(release, held.until - now);
    held.timer.unref?.();
    return held.until;
  }

  const timer = setTimeout(release, ms);
  timer.unref?.();
  watches.set(key, { timer, until });
  if (addPeekViewer(userId, tab, channel)) {
    await enqueuePeekCommand(userId, "peek_start", command).catch(() => {});
  }
  return until;
}

/** Whether this bot is watching the session now (for tests and the read). */
export function isWatched(userId: string, tab: string, channel?: BuilderChannel): boolean {
  return watches.has(watchKey(userId, tab, channel));
}
