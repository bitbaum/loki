/**
 * The push path and the fetch path must agree about one project.
 *
 * WHY THIS EXISTS
 *
 * /api/control/stream pushes per-project fast-state patches that are folded
 * into the snapshot /api/control returned, so the panel updates without a
 * refetch. That fold lived inside a useCallback in use-control-data and was
 * therefore untestable, while carrying three rules a later edit can quietly
 * break:
 *
 *   1. A patch matches by LIVE tab first, then by registry tab — a project
 *      running as "Loki Claude" is still the "Loki" row.
 *   2. Fields the patch OMITS are left alone. The stream carries what changed;
 *      treating absent as empty would wipe a prompt queue nobody touched.
 *   3. tabOpen maintains liveTabs case-insensitively, so active/idle
 *      categorisation stays live between polls.
 *
 * Run: npx tsx scripts/test/control-project-patch.ts
 */
import { applyProjectPatches } from "@/lib/control-project-patch";
import type { ControlData, ProjectState } from "@/lib/control-types";
import type { FastProjectState } from "@/lib/control-fast-state";

let passed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function check(label: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function project(overrides: Partial<ProjectState> & Pick<ProjectState, "tab">): ProjectState {
  return {
    id: "1",
    projectId: null,
    liveTab: overrides.tab,
    dir: "/tmp/proj",
    workspaceId: "ws",
    agentPref: "claude",
    modelPref: null,
    builderPref: null,
    session: null,
    git: null,
    sessionLifecycleSignals: true,
    agentRunning: false,
    activeAgents: [],
    profile: null,
    currentPrompt: null,
    readyAt: null,
    lockAt: null,
    closingAt: null,
    closedAt: null,
    recentCustomPrompts: [],
    recentActivity: [],
    recentOutcomes: [],
    liveAgentTurns: null,
    promptQueue: [],
    promptQueueRevision: 0,
    autoContinueEnabled: true,
    autoInjectModeOverride: null,
    latestOrchestrationRun: null,
    ...overrides,
  } as ProjectState;
}

function snapshot(projects: ProjectState[], liveTabs: string[] = []): ControlData {
  return { projects, liveTabs } as unknown as ControlData;
}

function patch(overrides: Partial<FastProjectState> & Pick<FastProjectState, "tab">) {
  return {
    agentRunning: false,
    activeAgents: [],
    session: null,
    currentPrompt: null,
    readyAt: null,
    lockAt: null,
    closingAt: null,
    closedAt: null,
    tabOpen: false,
    ...overrides,
  } as FastProjectState;
}

check("a patch keyed by the LIVE tab lands on its registry row", () => {
  const prev = snapshot([project({ tab: "Loki", liveTab: "Loki Claude" })]);
  const next = applyProjectPatches(prev, [patch({ tab: "Loki Claude", agentRunning: true })]);
  assert(next.projects[0].agentRunning === true, "the row the live tab belongs to updated");
  assert(next.projects[0].tab === "Loki", "and it is still the same registry row");
});

check("a patch for an unknown project changes nothing", () => {
  const prev = snapshot([project({ tab: "Loki", agentRunning: true })]);
  const next = applyProjectPatches(prev, [patch({ tab: "Elsewhere", agentRunning: false })]);
  assert(next.projects[0].agentRunning === true, "the untouched row is untouched");
});

check("omitted fields survive — the stream carries changes, not state", () => {
  const prev = snapshot([
    project({
      tab: "Loki",
      promptQueue: ["ship the thing"],
      promptQueueRevision: 7,
      autoContinueEnabled: false,
    }),
  ]);
  const next = applyProjectPatches(prev, [patch({ tab: "Loki", agentRunning: true })]);
  assert(next.projects[0].promptQueue.length === 1, "a queue nobody touched is still there");
  assert(next.projects[0].promptQueueRevision === 7, "and so is its revision");
  assert(next.projects[0].autoContinueEnabled === false, "and the auto-continue choice");
});

check("a present field DOES overwrite", () => {
  const prev = snapshot([project({ tab: "Loki", promptQueue: ["old"] })]);
  const next = applyProjectPatches(prev, [patch({ tab: "Loki", promptQueue: [] })]);
  assert(next.projects[0].promptQueue.length === 0, "an explicitly empty queue is emptied");
});

check("tabOpen adds and removes liveTabs, case-insensitively", () => {
  const prev = snapshot([project({ tab: "Loki" })], []);
  const opened = applyProjectPatches(prev, [patch({ tab: "Loki", tabOpen: true })]);
  assert(opened.liveTabs.includes("Loki"), "an opened tab joins liveTabs");

  const again = applyProjectPatches(opened, [patch({ tab: "loki", tabOpen: true })]);
  assert(again.liveTabs.length === 1, "a differently-cased repeat does not duplicate it");

  const closed = applyProjectPatches(again, [patch({ tab: "LOKI", tabOpen: false })]);
  assert(closed.liveTabs.length === 0, "and a differently-cased close still removes it");
});

check("the fold is pure — the previous snapshot is not mutated", () => {
  const prev = snapshot([project({ tab: "Loki" })], []);
  applyProjectPatches(prev, [patch({ tab: "Loki", agentRunning: true, tabOpen: true })]);
  assert(prev.projects[0].agentRunning === false, "the old snapshot still reads false");
  assert(prev.liveTabs.length === 0, "and still has no live tabs");
});

console.log(`\n${passed}/${passed} passed`);
