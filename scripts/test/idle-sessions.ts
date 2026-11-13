// The cloud builder closes agent sessions nobody has touched for hours
// (lib/idle-sessions).
import assert from "node:assert/strict";
import {
  AGENT_IDLE_CLOSE_HOURS_DEFAULT,
  agentIdleCloseMs,
  idleSessionsToClose,
} from "../../src/lib/idle-sessions";
import { shellTabFromHex } from "../../src/lib/shell-session";

const HOUR = 60 * 60 * 1000;
const now = 1_000 * HOUR;

assert.equal(agentIdleCloseMs({}), AGENT_IDLE_CLOSE_HOURS_DEFAULT * HOUR);
assert.equal(agentIdleCloseMs({ LOKI_AGENT_IDLE_CLOSE_HOURS: "2" }), 2 * HOUR);
assert.equal(agentIdleCloseMs({ LOKI_AGENT_IDLE_CLOSE_HOURS: "0" }), 0);
assert.equal(
  agentIdleCloseMs({ LOKI_AGENT_IDLE_CLOSE_HOURS: "soon" }),
  AGENT_IDLE_CLOSE_HOURS_DEFAULT * HOUR,
);

const sessions = [
  { tab: "quiet", lastActivityAt: now - 7 * HOUR },
  { tab: "working", lastActivityAt: now - 60_000 },
  { tab: "untracked" },
  { tab: shellTabFromHex("deadbeef"), lastActivityAt: now - 30 * HOUR },
];
const close = (over: Partial<Parameters<typeof idleSessionsToClose>[0]> = {}) =>
  idleSessionsToClose({ channel: "cloud", now, sessions, maxIdleMs: 6 * HOUR, ...over });

// Only the session quiet past the window; never a shell, never one with no clock.
assert.deepEqual(close(), ["quiet"]);
// A person's own computer is left alone.
assert.deepEqual(close({ channel: "local" }), []);
// Switched off.
assert.deepEqual(close({ maxIdleMs: 0 }), []);
console.log("✓ idle-sessions");
