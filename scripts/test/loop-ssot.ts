/**
 * Regression checks for autonomous loop entrypoints.
 * Run: npx tsx scripts/test/loop-ssot.ts
 */
import fs from "node:fs";
import assert from "node:assert/strict";

// The night builds from the inbox through the Implement path and reads a
// site through the review prompt — never a bare next_best guess, never a raw
// pending_commands insert (both skip context, policy and run tracking).
const night = fs.readFileSync("src/lib/autopilot-night.ts", "utf8");
assert.match(night, /implementFeedback\(userId, fix\.feedbackId\)/);
assert.match(night, /customPrompt:\s*composeReviewPrompt\(/);
assert.doesNotMatch(night, /promptKey:\s*"next_best"/);
assert.doesNotMatch(night, /db\.insert\(pendingCommands\)\.values/);
assert.match(night, /evaluateScheduledDispatch\(/, "the night asks the same gates as Control");
assert.ok(!fs.existsSync("src/app/api/crons/nudge-idle/route.ts"), "nudge-idle is retired");

const fleetKick = fs.readFileSync("src/lib/fleet-kick.ts", "utf8");
assert.match(fleetKick, /injectPrompt\(\{\s*tab:\s*projectKey,\s*promptKey:\s*"next_best"/s);
assert.match(fleetKick, /reason:\s*"no_path"/);

console.log("✓ loop SSOT checks passed");
