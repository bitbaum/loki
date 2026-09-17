/**
 * Inline self-tests for agent-resolution helpers.
 * Run: npm run test:agent-resolution
 */
import {
  inferAdapterFromTabName,
  resolveDetectedAgentIds,
  resolveOutgoingAgent,
  hasAgentLabelMismatch,
  detectCapacityIssueFromProject,
  resolveNextFallbackAgent,
  looksLikeAgentCapacityIssue,
} from "@/lib/agent-resolution";
import type { ProjectState } from "@/lib/control-types";

function stubProject(overrides: Partial<ProjectState> & Pick<ProjectState, "tab">): ProjectState {
  return {
    id: "1",
    projectId: null,
    liveTab: overrides.tab,
    dir: "/tmp/proj",
    agentPref: "claude",
    modelPref: null,
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
    latestOrchestrationRun: null,
    autoInjectModeOverride: null,
    ...overrides,
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function runTests(): void {
  let passed = 0;
  const check = (label: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  };

  check("inferAdapterFromTabName suffix", () => {
    assert(inferAdapterFromTabName("Loki Codex") === "codex", "expected codex");
  });

  check("resolveDetectedAgentIds prefers activeAgents", () => {
    const project = stubProject({
      tab: "Loki",
      activeAgents: ["codex"],
      agentPref: "claude",
    });
    assert(resolveDetectedAgentIds(project)[0] === "codex", "expected live codex");
  });

  check("resolveOutgoingAgent uses live scan over preference", () => {
    const project = stubProject({
      tab: "Loki",
      activeAgents: ["codex"],
      agentPref: "claude",
    });
    assert(resolveOutgoingAgent(project, "claude") === "codex", "expected codex outgoing");
  });

  check("hasAgentLabelMismatch when pref disagrees with /proc", () => {
    const project = stubProject({
      tab: "Loki",
      agentRunning: true,
      activeAgents: ["codex"],
      agentPref: "claude",
    });
    assert(hasAgentLabelMismatch(project, "claude"), "expected mismatch");
  });

  check("detectCapacityIssueFromProject reads session text", () => {
    const project = stubProject({
      tab: "Loki",
      session: {
        status: "working",
        done: "rate limit exceeded",
        next: "",
        tests: "",
        todos: "",
        health: "good",
        mtime: Date.now(),
      },
    });
    assert(detectCapacityIssueFromProject(project), "expected capacity issue");
  });

  check("resolveNextFallbackAgent skips current", () => {
    assert(
      resolveNextFallbackAgent("codex", ["claude", "cursor", "codex"]) === "claude",
      "expected claude",
    );
  });

  check("looksLikeAgentCapacityIssue matches quota", () => {
    assert(looksLikeAgentCapacityIssue("You have exceeded your quota"), "expected quota match");
  });

  check("looksLikeAgentCapacityIssue matches CLI weekly-limit screens", () => {
    assert(
      looksLikeAgentCapacityIssue("You hit your weekly limit. Weekly limit left: 0%"),
      "expected weekly-limit match",
    );
  });

  console.log(`\n${passed} agent-resolution tests passed`);
}

runTests();
