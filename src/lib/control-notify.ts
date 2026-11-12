import postgres from "postgres";
import { NOTIFY_CHANNEL } from "@/db/setup-notify-trigger";
import { getDatabaseDirectUrl } from "@/lib/db-url";
import { sseBus } from "@/lib/sse-bus";

/**
 * ONE Postgres LISTEN connection per server process, shared by every
 * /api/control/stream subscriber.
 *
 * Each stream used to open its own `postgres(url, { max: 1 })` listener and
 * meant to close it in a function returned from ReadableStream `start()`,
 * which the platform ignores (only `cancel()` runs on disconnect). Every page
 * view leaked one connection: on 2026-11-12 Loki held 95 of the box's 100,
 * idle for up to 10 hours, and Morulia, Solon, AOZ and Substrata got
 * "sorry, too many clients already" (sign-in 500s, /statistics 500,
 * Substrata /api/health 503). Now the listener is a process singleton and a
 * notification fans out over the in-process bus.
 */
const KEY = "$$loki_control_notify_listener";
type Holder = { started: boolean };
const g = globalThis as unknown as Record<string, Holder | undefined>;

export function notifyChannel(userId: string): string {
  return `control-notify:${userId}`;
}

function ensureListener(): void {
  const holder = (g[KEY] ??= { started: false });
  if (holder.started) return;
  const url = getDatabaseDirectUrl();
  if (!url) return;
  holder.started = true;
  // idle_timeout must stay off for a LISTEN connection; postgres.js re-LISTENs
  // on reconnect by itself.
  const sql = postgres(url, { max: 1 });
  sql
    .listen(NOTIFY_CHANNEL, (userId) => {
      if (userId) sseBus.emit(notifyChannel(userId));
    })
    .catch((err) => {
      holder.started = false;
      sql.end({ timeout: 1 }).catch(() => {});
      console.warn("[control-notify] LISTEN setup failed:", err);
    });
}

/** Wake `onNotify` when a project_states row of `userId` changes. Returns the unsubscribe. */
export function subscribeControlNotify(userId: string, onNotify: () => void): () => void {
  ensureListener();
  const channel = notifyChannel(userId);
  sseBus.on(channel, onNotify);
  return () => {
    sseBus.off(channel, onNotify);
  };
}
