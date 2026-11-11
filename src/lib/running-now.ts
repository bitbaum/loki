/**
 * Home's answer to "is anything running?", in a sentence.
 *
 * The line used to read "0 working · 0 awaiting input · 32 idle · Counts only
 * agents Loki started". The owner, on a phone on 2026-11-11, could not tell
 * from it whether anything was running. The idle count is every project that
 * is doing nothing, which is not news; the caveat is folded into the words.
 */
export interface RunningNow {
  /** What to say first. */
  headline: string;
  /** Agents working now: worth a way to watch them. */
  working: number;
  /** Agents that stopped to ask the person something. */
  waiting: number;
}

const agents = (n: number): string => (n === 1 ? "1 agent" : `${n} agents`);

export function runningNow(counts: { working: number; waiting: number }): RunningNow {
  const working = Math.max(0, counts.working);
  const waiting = Math.max(0, counts.waiting);
  const headline =
    working > 0
      ? `${agents(working)} working now`
      : waiting > 0
        ? "Nothing is working. Waiting for your reply"
        : "Nothing Loki started is running right now";
  return { headline, working, waiting };
}
