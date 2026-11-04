import assert from "node:assert/strict";
import { idleProjectFor, resolveProjectToTab } from "../../src/lib/terminal-project-selection";
import { resolveTabAttachment } from "../../src/lib/terminal-viewport";
import type { TerminalContext } from "../../src/app/api/terminal/context/route";

const project = { name: "my-project", agentPref: "codex" };
const input = {
  requested: "MY-PROJECT",
  activeTab: null,
  loading: false,
  gatedMessage: null,
  shell: false,
  context: { startable: [project], launchable: [] } as unknown as TerminalContext,
};
// Repository-only projects have no Resume directory but can receive a task.
assert.deepEqual(idleProjectFor(input), project);
for (const patch of [
  { requested: "someone-elses-project" },
  { requested: null },
  { activeTab: "another-session" },
  { loading: true },
  { gatedMessage: "Access is disabled" },
  { shell: true },
  { context: null },
])
  assert.equal(idleProjectFor({ ...input, ...patch }), null);

// An idle project attaches to nothing, then to its own newly reported session.
assert.deepEqual(
  resolveTabAttachment({
    requestedTab: project.name,
    selected: project.name,
    tabs: ["unrelated"],
    loading: false,
  }),
  { activeTab: null, deepLinkMiss: true },
);
assert.deepEqual(
  resolveTabAttachment({
    requestedTab: project.name,
    selected: project.name,
    tabs: ["unrelated", project.name],
    loading: false,
  }),
  { activeTab: project.name, deepLinkMiss: false },
);
console.log("✓ Idle project: registered scope, repository-only start and safe session attachment");

const context = {
  tabs: [
    { tab: "Tab 1", projectName: "my-project" },
    { tab: "other", projectName: "unrelated" },
  ],
} as TerminalContext;
assert.equal(resolveProjectToTab("MY-PROJECT", context), "Tab 1");
assert.equal(resolveProjectToTab("tab 1", context), "Tab 1");
assert.equal(resolveProjectToTab("missing", context), "missing");
assert.equal(resolveProjectToTab(null, context), null);
