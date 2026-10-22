/**
 * Delivery to the app, on the box: POST the signed InboundMail to
 * http://127.0.0.1:<port>/api/mail/inbound. 2xx = the app stored it. Anything
 * else is retried with backoff — a 404 included, because an app that has not
 * adopted the route yet should get its mail the day it does.
 */
import { INBOUND_PATH, INBOUND_SIGNATURE_HEADER, signInbound } from "@bitbaum/mail-kit";
import type { Spool, Spooled } from "./spool.js";

/** Minutes to wait after the nth failed attempt; the last repeats. */
export const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360];

export function nextAttemptAt(attempts: number, now: number): number {
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 360;
  return now + minutes * 60_000;
}

export async function deliverOne(
  entry: Spooled,
  {
    secret,
    base = "http://127.0.0.1",
    fetchImpl = fetch,
    timeoutMs = 15_000,
  }: { secret: string; base?: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = JSON.stringify(entry.mail);
  try {
    const res = await fetchImpl(`${base}:${entry.port}${INBOUND_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INBOUND_SIGNATURE_HEADER]: signInbound(body, secret),
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** One pass over the spool: everything due is tried once. */
export async function deliverDue(
  spool: Spool,
  opts: Parameters<typeof deliverOne>[1],
  now = Date.now(),
): Promise<{ delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;
  for (const entry of spool.pending()) {
    if (entry.nextAt > now) continue;
    const result = await deliverOne(entry, opts);
    if (result.ok) {
      spool.done(entry.mail.id);
      delivered++;
    } else {
      const attempts = entry.attempts + 1;
      spool.put({
        ...entry,
        attempts,
        nextAt: nextAttemptAt(attempts, now),
        lastError: result.error,
      });
      failed++;
    }
  }
  return { delivered, failed };
}
