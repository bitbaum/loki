/**
 * Bridge presence channel must match the runtime-state heartbeat channel.
 * A box-* version that registered as "local" made /terminal say Cloud offline
 * while the box-runner was shipping.
 *
 * Run: npx tsx scripts/test/runner-presence-channel.ts
 */
import assert from "node:assert/strict";
import { resolveRunnerPresenceChannel } from "../../desktop/src/main/bridge-subscriber";

const savedPresence = process.env.LOKI_RUNNER_PRESENCE_CHANNEL;
const savedVersion = process.env.LOKI_RUNNER_VERSION;

function withEnv(env: { presence?: string; version?: string }, fn: () => void): void {
  if (env.presence === undefined) delete process.env.LOKI_RUNNER_PRESENCE_CHANNEL;
  else process.env.LOKI_RUNNER_PRESENCE_CHANNEL = env.presence;
  if (env.version === undefined) delete process.env.LOKI_RUNNER_VERSION;
  else process.env.LOKI_RUNNER_VERSION = env.version;
  try {
    fn();
  } finally {
    if (savedPresence === undefined) delete process.env.LOKI_RUNNER_PRESENCE_CHANNEL;
    else process.env.LOKI_RUNNER_PRESENCE_CHANNEL = savedPresence;
    if (savedVersion === undefined) delete process.env.LOKI_RUNNER_VERSION;
    else process.env.LOKI_RUNNER_VERSION = savedVersion;
  }
}

withEnv({ version: "box-0.8.31" }, () => {
  assert.equal(resolveRunnerPresenceChannel(), "cloud", "box-* version → cloud");
});
withEnv({ version: "box" }, () => {
  assert.equal(resolveRunnerPresenceChannel(), "cloud", "bare box → cloud");
});
withEnv({ version: "0.8.31" }, () => {
  assert.equal(resolveRunnerPresenceChannel(), "local", "desktop semver → local");
});
withEnv({ version: "dev" }, () => {
  assert.equal(resolveRunnerPresenceChannel(), "local", "dev desktop → local");
});
withEnv({ presence: "cloud", version: "0.8.31" }, () => {
  assert.equal(resolveRunnerPresenceChannel(), "cloud", "explicit env wins over version");
});
withEnv({ presence: "local", version: "box-0.8.31" }, () => {
  assert.equal(resolveRunnerPresenceChannel(), "local", "explicit local wins over box-");
});

console.log("✓ runner-presence-channel");
