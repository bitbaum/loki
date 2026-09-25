/**
 * Inline tests for fleet-kick helpers and Loki NL detection.
 * Run: npm run test:fleet-kick
 */
import assert from "node:assert/strict";
import {
  formatFleetKickReply,
  sortProjectsForKick,
  type FleetKickReplyResult,
} from "@/lib/fleet-kick-format";
import { isDevelopAllFleetRequest } from "@/lib/loki-fleet-commands";
import { resolveDispatchTargets, shouldAskForProject } from "@/lib/loki/dispatch-targets";
import { deriveProjectLoopReadiness } from "@/lib/project-loop-readiness";
import {
  shouldDispatchScreenshot,
  isDefaultVisionQuestion,
  isScreenshotImplementIntent,
} from "@/lib/loki/screenshot-dispatch";
import type { CommandResolution } from "@/lib/command-resolve";

function testSortProjectsForKick() {
  const ready = new Set(["beta", "alpha"]);
  const sorted = sortProjectsForKick(["zeta", "alpha", "beta", "gamma"], ready);
  assert.deepEqual(sorted, ["alpha", "beta", "gamma", "zeta"]);
}

function testDevelopAllFleetPhrases() {
  assert.equal(isDevelopAllFleetRequest("develop all my projects"), true);
  assert.equal(isDevelopAllFleetRequest("build the whole fleet"), true);
  assert.equal(isDevelopAllFleetRequest("start every project"), true);
  assert.equal(isDevelopAllFleetRequest("code review for loki"), false);
  assert.equal(isDevelopAllFleetRequest("next best for loki"), false);
}

function testDispatchTargets() {
  const resolution = (partial: Partial<CommandResolution>): CommandResolution => ({
    kind: "command",
    projectKey: null,
    intentId: "quality",
    prompt: "code review",
    needsProject: false,
    reason: "test",
    ...partial,
  });

  assert.deepEqual(
    resolveDispatchTargets({
      resolution: resolution({ projectKey: "a" }),
      selectedProjects: ["b", "c"],
      namedInText: null,
    }),
    ["b", "c"],
  );

  assert.deepEqual(
    resolveDispatchTargets({
      resolution: resolution({ projectKey: "a" }),
      selectedProjects: ["b", "c"],
      namedInText: "a",
    }),
    ["a"],
  );

  // No projects: never ask "which project?" — there is nothing to pick.
  assert.equal(shouldAskForProject({ needsProject: true }, []), false);
  assert.equal(shouldAskForProject({ needsProject: true }, ["loki"]), true);
  assert.equal(shouldAskForProject({ needsProject: false }, ["loki"]), false);
}

function testScreenshotDispatch() {
  assert.equal(
    shouldDispatchScreenshot("What's wrong here and what should we change?", true, "loki"),
    true,
  );
  assert.equal(shouldDispatchScreenshot("implement this ui", true, "loki"), true);
  assert.equal(shouldDispatchScreenshot("what do you think?", true, "loki"), false);
  assert.equal(shouldDispatchScreenshot("implement this", true, null), false);
  assert.equal(isDefaultVisionQuestion("What's wrong here and what should we change?"), true);
  assert.equal(isScreenshotImplementIntent("please implement the layout"), true);
}

function testProjectLoopReadiness() {
  assert.equal(deriveProjectLoopReadiness({ dirPath: "/repo/app" }).label, "Loop-ready");
  const missing = deriveProjectLoopReadiness({ dirPath: null });
  assert.equal(missing.reason, "no_path");
  assert.equal(missing.label, "Needs path");
  const paused = deriveProjectLoopReadiness({
    dirPath: "/repo/app",
    autoInjectModeOverride: "off",
  });
  assert.equal(paused.reason, "project_paused");
}

function testFleetKickReplyExplainsSkippedProjects() {
  const result: FleetKickReplyResult = {
    runnerConnected: false,
    fleetMode: "on",
    kicked: 0,
    activeBefore: 0,
    details: [
      { projectKey: "profile-only", outcome: "skipped", reason: "no_path" },
      { projectKey: "queued", outcome: "skipped", reason: "pending_command" },
    ],
    message: "No idle projects to kick right now.",
  };
  const reply = formatFleetKickReply(result);
  assert.match(reply, /\*\*Skipped:\*\*/);
  assert.match(reply, /profile-only: needs a local path/);
  assert.match(reply, /queued: already queued/);
}

testSortProjectsForKick();
testDevelopAllFleetPhrases();
testDispatchTargets();
testScreenshotDispatch();
testProjectLoopReadiness();
testFleetKickReplyExplainsSkippedProjects();

console.log("✓ fleet-kick helper tests passed");
