/**
 * /terminal says whose cloud builder is off.
 *
 * QA's seat (2026-11-12) read "Cloud sessions are offline", and at 1366
 * "Cloud runner offline", while the fleet's runner was up. Presence is read
 * per account (docs/architecture/private-builders.md): the seat's own cloud
 * builder was what was off. The words now say which: this account's own
 * builder, or a runner this account cannot see at all.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { cloudBuilderScope } from "../../src/lib/cloud-builder-scope";
import { EXECUTOR_COPY } from "../../src/config/executor-copy";

assert.equal(cloudBuilderScope({ isDefault: true }), "fleet");
assert.equal(cloudBuilderScope({ isDefault: false, privateBuilder: true }), "private");
assert.equal(cloudBuilderScope({ isDefault: false, privateBuilder: false }), "none");
assert.equal(cloudBuilderScope(null), "none");

assert.match(EXECUTOR_COPY.terminal.cloudPrivateOfflineHint, /This account's own cloud builder/);
assert.match(EXECUTOR_COPY.terminal.cloudNotYoursHint, /^You can't see this cloud runner/);
assert.doesNotMatch(EXECUTOR_COPY.builder.ownCloudOffline, /^Cloud runner offline$/);

const read = (p: string) => fs.readFileSync(p, "utf8");
const presence = read("src/app/api/builder/presence/route.ts");
assert.match(presence, /cloudScope: user \? cloudBuilderScope\(user\) : null/);

const surface = read("src/components/terminal/TerminalSurface.tsx");
assert.match(
  surface,
  /presence\.cloudScope === "private"\)\s*return EXECUTOR_COPY\.terminal\.cloudPrivateOfflineHint/,
  "the empty terminal names this account's own builder",
);
assert.match(surface, /cloudScope === "none"\) return EXECUTOR_COPY\.terminal\.cloudNotYoursHint/);
assert.match(surface, /label: EXECUTOR_COPY\.builder\.ownCloudOffline/, "the chip too");

// Not allowed on the cloud is gated, never "offline", even before open-tabs answers.
const tabs = read("src/components/terminal/use-terminal-tabs.ts");
assert.match(tabs, /presence\.cloudBuilderAllowed === false/);
assert.match(tabs, /const offline = connected === false && tabs\.length === 0 && !gatedMessage;/);

console.log("terminal-whose-runner ok");
