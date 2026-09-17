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

  // ── The operator's ranking governs which list the fallback walks ─────────
  // b71941be gave the operator a provider order in Settings → Agent, and every
  // resolver kept walking the hardcoded fleet order instead — so the ranking
  // changed nothing on Control or under the headless reroute.
  //
  // NOTE the semantics these pin: this resolver ADVANCES PAST the current agent
  // in the ranking; it does not return the operator's top choice. That is
  // deliberate and load-bearing for auto-reroute — current moves on each
  // capacity wall, so advancing walks the whole list, while "always the top
  // choice" would re-suggest an already-tried agent and decideAutoReroute would
  // stop at "all-tried" after about two hops instead of trying everything.

  check("the operator's order changes which agent comes next", () => {
    const available = ["claude", "cursor", "codex", "grok"];
    // Same inputs, two rankings, two answers — the ranking is load-bearing.
    assert(
      resolveNextFallbackAgent("codex", available) === "grok",
      "fleet default: grok follows codex",
    );
    assert(
      resolveNextFallbackAgent("codex", available, ["claude", "grok", "codex", "cursor"]) ===
        "cursor",
      "operator order: cursor follows codex",
    );
  });

  check("an agent the operator did not rank is still reachable", () => {
    // A half-filled preference must not shrink the fallback set to nothing.
    assert(
      resolveNextFallbackAgent("claude", ["claude", "cursor"], ["grok"]) === "cursor",
      "expected the unranked-but-installed agent",
    );
  });

  check("the operator's order never resurrects an uninstalled agent", () => {
    assert(
      resolveNextFallbackAgent("claude", ["claude", "codex"], ["grok", "cursor", "codex"]) ===
        "codex",
      "expected codex — grok and cursor are not installed",
    );
  });

  check("no order given still behaves exactly as before", () => {
    assert(
      resolveNextFallbackAgent("codex", ["claude", "cursor", "codex"]) === "claude",
      "expected the fleet default for a caller with no user context",
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
