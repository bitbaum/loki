/**
 * Time primitives — single source of truth for millisecond arithmetic.
 * Previously sites scattered `86_400_000`, `24 * 60 * 60 * 1000`,
 * `3_600_000`, and `60_000`-style expressions for the same durations,
 * inviting drift and off-by-a-zero bugs.
 *
 * Build every duration from these primitives (`7 * DAY_MS`, not a raw
 * literal). Keep local semantic names at call sites — e.g.
 * `const CACHE_TTL_MS = HOUR_MS` — so intent stays visible.
 */

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/** SSE keepalive comment interval — shared by the three SSE stream routes
 *  (/api/control/stream, /api/control/peek-stream, /api/workspaces/[id]/stream)
 *  so proxies don't drop the idle connection. */
export const SSE_KEEPALIVE_MS = 15 * SECOND_MS;

/** Auth-route rate-limit window for user-triggered email sends
 *  (forgot-password, resend-verification). */
export const RATE_LIMIT_WINDOW_SHORT_MS = 15 * MINUTE_MS;

/** Auth-route rate-limit window for sensitive account mutations
 *  (register, password change). */
export const RATE_LIMIT_WINDOW_LONG_MS = HOUR_MS;

/** Outbound HTTP — quick API probes (GitHub metadata, OAuth token exchange). */
export const HTTP_TIMEOUT_SHORT_MS = 10 * SECOND_MS;

/** Outbound HTTP — default budget for a standard external call. */
export const HTTP_TIMEOUT_MS = 15 * SECOND_MS;

/** Outbound HTTP — LLM completions and other slow endpoints. */
export const HTTP_TIMEOUT_LONG_MS = 30 * SECOND_MS;

/** Outbound HTTP — the longest LLM calls (vision, plan generation). */
export const HTTP_TIMEOUT_XL_MS = 45 * SECOND_MS;

/**
 * A model call is bounded by SILENCE, not by a stopwatch (lib/agent/call-timeout.ts).
 * First byte: how long a vendor may think before saying anything. A user's
 * own key may be on a reasoning model that thinks for a minute; the free
 * chain is fast models and 30 s already means "down". Idle: bytes were
 * flowing and stopped. Total: the hard ceiling whatever flows.
 */
export const MODEL_FIRST_BYTE_OWN_MS = 90 * SECOND_MS;
export const MODEL_STREAM_IDLE_MS = 30 * SECOND_MS;
export const MODEL_CALL_TOTAL_MS = 5 * 60 * SECOND_MS;

/** Subprocess default — local CLI tools and git probes. */
export const EXEC_TIMEOUT_MS = 15 * SECOND_MS;

/** Subprocess — clones, pushes, builds, and other long git operations. */
export const EXEC_TIMEOUT_LONG_MS = 2 * MINUTE_MS;
