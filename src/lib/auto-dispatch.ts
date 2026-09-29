/**
 * The one switch for every agent run Loki would start WITHOUT a person's tap.
 *
 * Three paths re-dispatch on their own: a feedback run the runner refused
 * (feedback/auto-reimplement), any other project run it refused
 * (project-retry), and a queued Implement no builder claimed (the
 * check-feedback-needs-you cron → feedback/retry-queued). Each spends the
 * operator's provider quota — Claude, Codex, Gemini — on a decision nobody
 * made. On 2026-09-29 the owner asked for exactly none of that: "no auto
 * stuff with my tokens". So the default is OFF, in one place, and a retry the
 * machine would have made is left on the row as Failed with a Retry button.
 *
 * Opting in is an environment decision on the box, not a per-project toggle,
 * because the bill is per account: `LOKI_AUTO_DISPATCH=1`.
 */
export const AUTO_DISPATCH_ENV = "LOKI_AUTO_DISPATCH";

/** Pure: reads the switch from the given environment (tests pass their own). */
export function autoDispatchEnabledIn(env: Record<string, string | undefined>): boolean {
  return env[AUTO_DISPATCH_ENV] === "1";
}

export function autoDispatchEnabled(): boolean {
  return autoDispatchEnabledIn(process.env);
}

/** The reason recorded when a path stands down, so a log line says why. */
export const AUTO_DISPATCH_OFF_REASON = "auto-dispatch-off";
