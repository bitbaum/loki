/**
 * How long a model call may take — three limits, not one.
 *
 * A single `AbortSignal.timeout(30s)` on the whole fetch killed the first
 * real turn on a user's own key (xAI grok-4.7, 2026-10-10): a reasoning model
 * that thinks for forty seconds before its first token, or a long answer
 * that streams for a minute, is not a hung vendor. It is working. What a
 * hung vendor looks like is SILENCE — no first byte, or no further byte —
 * and that is what is bounded here:
 *
 *   firstByteMs   nothing at all has arrived yet (headers count)
 *   idleMs        bytes were flowing and stopped
 *   totalMs       the hard ceiling, so a vendor trickling one token a
 *                 second cannot hold a turn open for an hour
 *
 * Pure apart from timers; `scripts/test/call-timeout.ts` drives it with a
 * fake clock.
 */
export type CallTimeouts = { firstByteMs: number; idleMs: number; totalMs: number };

export type CallTimeout = {
  signal: AbortSignal;
  /** Call on every byte (headers, each stream chunk): re-arms the idle limit. */
  sawByte: () => void;
  /** Call when the response has been fully read: stops every timer. */
  done: () => void;
  /** The sentence for the failure, once aborted; null while still alive. */
  reason: () => string | null;
};

/** A timer seam, so a test can drive the clock. */
export type TimerHost = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

const secs = (ms: number) => `${Math.round(ms / 1000)} s`;

export function createCallTimeout(
  limits: CallTimeouts,
  host: TimerHost = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as never),
  },
): CallTimeout {
  const controller = new AbortController();
  let why: string | null = null;
  let gotFirst = false;
  let quiet: unknown = null;

  const abort = (sentence: string) => {
    if (controller.signal.aborted) return;
    why = sentence;
    controller.abort(new Error(sentence));
  };

  const total = host.setTimeout(
    () => abort(`still answering after ${secs(limits.totalMs)} — stopped waiting`),
    limits.totalMs,
  );
  const armQuiet = () => {
    if (quiet !== null) host.clearTimeout(quiet);
    quiet = host.setTimeout(
      () =>
        abort(
          gotFirst
            ? `went silent for ${secs(limits.idleMs)} mid-answer`
            : `no answer within ${secs(limits.firstByteMs)}`,
        ),
      gotFirst ? limits.idleMs : limits.firstByteMs,
    );
  };
  armQuiet();

  return {
    signal: controller.signal,
    sawByte: () => {
      if (controller.signal.aborted) return;
      gotFirst = true;
      armQuiet();
    },
    done: () => {
      host.clearTimeout(total);
      if (quiet !== null) host.clearTimeout(quiet);
      quiet = null;
    },
    reason: () => why,
  };
}
