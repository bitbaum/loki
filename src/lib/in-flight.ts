/**
 * One run per key at a time. A second call with the same key while the first
 * is still running waits for it to finish and then runs itself — so a double
 * tap or a retry after a network blip finds what the first call made (the
 * callee checks) instead of making a second one. Copied once already between
 * the brief kickoff and the website preview; now in one place.
 */
const running = new Map<string, Promise<unknown>>();

export async function withInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = running.get(key);
  if (prior) await prior.catch(() => undefined);
  const run = fn();
  running.set(key, run);
  try {
    return await run;
  } finally {
    if (running.get(key) === run) running.delete(key);
  }
}
