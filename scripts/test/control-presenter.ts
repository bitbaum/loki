/**
 * Inline self-tests for control-presenter live tab mapping.
 * Run: npm run test:control-presenter
 */
import {
  buildControlPageState,
  buildLiveTabRows,
  buildProjectOperationsSnapshot,
  buildProjectOperationsSnapshots,
  deriveFleetPulse,
  findProjectForOpenTab,
  formatAgentRuntimeLabel,
  inferAgentLabelFromTabName,
  getProjectDisplayState,
  isProjectTabOpen,
  isCurrentPromptStale,
} from "@/components/control/control-presenter";
// From lib/, NOT db/queries — importing the query module would pull in the
// database connection and fail this suite at import time with no DATABASE_URL.
import { bucketTurnsByProject } from "@/lib/agent-turns";
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
    verifiedRunActive: false,
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
    latestOrchestrationRun: null,
    ...overrides,
  };
}

/** An agent that reported a turn start `minutesAgo` and no end. */
function openTurn(minutesAgo: number, count = 1) {
  return {
    count,
    startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    cwds: ["/tmp/proj"],
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

  check("findProjectForOpenTab exact match", () => {
    const projects = [stubProject({ tab: "Loki", liveTab: "Loki" })];
    assert(findProjectForOpenTab("Loki", projects)?.tab === "Loki", "expected Loki");
  });

  check("findProjectForOpenTab prefix match (agent suffix tab)", () => {
    const projects = [stubProject({ tab: "Loki", liveTab: "Loki Claude" })];
    assert(findProjectForOpenTab("Loki Claude", projects)?.tab === "Loki", "expected prefix match");
  });

  check("isProjectTabOpen accepts agent-suffixed live tabs", () => {
    const project = stubProject({ tab: "Loki", liveTab: "Loki" });
    assert(isProjectTabOpen(project, ["Loki Claude"]), "expected suffix tab to count as open");
    assert(!isProjectTabOpen(project, ["Cockpit2 Claude"]), "must not match unrelated prefixes");
  });

  check("isProjectTabOpen accepts a different live agent suffix than cached liveTab", () => {
    const project = stubProject({ tab: "Loki", liveTab: "Loki Claude" });
    assert(
      isProjectTabOpen(project, ["Loki Codex"]),
      "expected canonical project suffix to count as open",
    );
  });

  check("buildLiveTabRows sorts Working before Open and drops unregistered tabs", () => {
    // 2026-05-31: unregistered ("Tab #1 Unlinked") tabs are filtered out
    // of the default rows — they were visible noise that mapped to no
    // project. Test asserts the new filter behavior.
    const nowS = 1_700_000_000;
    const projects = [
      stubProject({
        tab: "IdleProj",
        liveTab: "IdleProj",
        agentRunning: false,
      }),
      stubProject({
        tab: "Active",
        liveTab: "Active",
        agentRunning: true,
        currentPrompt: { key: "k", label: "Fix tests", startedAt: nowS - 10 },
        activeAgents: ["claude"],
      }),
    ];
    const rows = buildLiveTabRows(["Active", "IdleProj", "Mystery"], projects, nowS);
    assert(
      rows.length === 2,
      `expected 2 rows (Mystery dropped as unregistered), got ${rows.length}`,
    );
    assert(rows[0]?.tabName === "Active", "working tab first");
    assert(rows[0]?.stateLabel === "Working", "working state");
    assert(rows[1]?.tabName === "IdleProj", "registered idle tab second");
    assert(
      rows.every((r) => r.registered === true),
      "no unregistered tabs in output",
    );
  });

  check("formatAgentRuntimeLabel maps cursor agent id", () => {
    const label = formatAgentRuntimeLabel(
      stubProject({
        tab: "X",
        activeAgents: ["cursor"],
      }),
    );
    assert(label === "Cursor", `expected Cursor, got ${label}`);
  });

  check("formatAgentRuntimeLabel maps legacy agent basename", () => {
    const label = formatAgentRuntimeLabel(
      stubProject({
        tab: "X",
        activeAgents: ["agent"],
      }),
    );
    assert(label === "Cursor", `expected Cursor, got ${label}`);
  });

  check("inferAgentLabelFromTabName reads common agent suffixes", () => {
    assert(inferAgentLabelFromTabName("Loki Codex") === "Codex", "expected Codex suffix");
    assert(inferAgentLabelFromTabName("ops-grok") === "Grok", "expected Grok suffix");
    assert(inferAgentLabelFromTabName("scratch") === null, "expected no inferred agent");
  });

  check("unknown runner state suppresses cached working and ready signals", () => {
    const nowS = 1_700_000_000;
    const project = stubProject({
      tab: "Disconnected",
      agentRunning: true,
      currentPrompt: { key: "custom", label: "Never delivered", startedAt: nowS - 10 },
      readyAt: nowS - 10,
      activeAgents: ["claude"],
    });
    const state = getProjectDisplayState(project, ["Disconnected"], nowS, false, false);
    assert(state.stateLabel === "Offline", "disconnected card must say Offline");
    assert(
      !state.isRunning && !state.isReady && !state.tabOpen,
      "stale live signals must be hidden",
    );
  });

  check("no detected process is reported as not running, not inferred activity", () => {
    const project = stubProject({ tab: "Loki" });
    const state = getProjectDisplayState(project, [], 1_700_000_000);
    assert(
      state.stateLabel === "Not running",
      "inactive project must describe the absent live signal",
    );
  });

  check("snapshot separates saved context from current operational state", () => {
    const nowS = 1_700_000_000;
    const snapshot = buildProjectOperationsSnapshot(
      stubProject({
        tab: "Loki",
        session: {
          done: "Done earlier",
          next: "Continue later",
          tests: "",
          todos: "",
          health: "",
          mtime: (nowS - 300) * 1000,
        },
      }),
      [],
      nowS,
    );
    assert(snapshot.phase === "not_running", "handoff must not imply a running agent");
    // Names the SIGNAL, like its "Last run" / "Last dispatch" siblings — "Idle"
    // described a state while the other two named their evidence.
    assert(
      snapshot.evidenceLabel === "Last handoff",
      `handoff evidence must name the handoff, got '${snapshot.evidenceLabel}'`,
    );
    assert(snapshot.evidenceKind === "historical", "handoff provenance must be historical");
  });

  check("a recent dispatch beats 'Not running' — work happens in tabs Loki can't see", () => {
    // The user runs 5-10 parallel sessions in kitty with unnamed tabs, so
    // live process detection sees nothing — yet hook-captured dispatches
    // prove the project was worked on. "Not running" contradicted the
    // recorded facts on the same card (loki, 2026-08-13).
    const nowS = 1_700_000_000;
    const state = getProjectDisplayState(
      stubProject({
        tab: "loki",
        recentActivity: [
          {
            id: "d1",
            projectKey: "loki",
            at: new Date((nowS - 2_640) * 1000).toISOString(),
            kind: "dispatch",
            source: "user",
            adapter: "claude",
            intent: "custom",
            title: "keep going",
            detail: null,
            status: "neutral",
          },
        ],
      }),
      [],
      nowS,
    );
    assert(
      state.stateKey === "recently_active",
      `recent dispatch must not read as dead, got '${state.stateKey}'`,
    );
    assert(state.stateLabel === "Active recently", "badge names the honest state");
  });

  check("an old dispatch does NOT keep a project looking active", () => {
    const nowS = 1_700_000_000;
    const state = getProjectDisplayState(
      stubProject({
        tab: "kivvi",
        recentActivity: [
          {
            id: "d2",
            projectKey: "kivvi",
            at: new Date((nowS - 30 * 86_400) * 1000).toISOString(),
            kind: "dispatch",
            source: "user",
            adapter: "claude",
            intent: "custom",
            title: "old work",
            detail: null,
            status: "neutral",
          },
        ],
      }),
      [],
      nowS,
    );
    assert(
      state.stateKey === "not_running",
      `a month-old dispatch is not recent activity, got '${state.stateKey}'`,
    );
  });

  check("a finished run fresher than the handoff names itself in the evidence", () => {
    // Sessions no longer run in named zellij tabs, so a project that ran via
    // dispatch 40 minutes ago has NO live signal — but "Idle today" (from a
    // stale handoff) reads as a dead project. The freshest recorded signal
    // must win: "Last run <when>". (orangecat, 2026-08-13.)
    const nowS = 1_700_000_000;
    const snapshot = buildProjectOperationsSnapshot(
      stubProject({
        tab: "orangecat",
        session: {
          done: "old",
          next: "",
          tests: "",
          todos: "",
          health: "",
          mtime: (nowS - 86_400) * 1000,
        },
        latestOrchestrationRun: {
          adapter: "claude",
          intent: "custom",
          state: "done",
          startedAt: new Date((nowS - 3_000) * 1000).toISOString(),
          finishedAt: new Date((nowS - 2_400) * 1000).toISOString(),
          summary: null,
          tokensIn: null,
          tokensOut: null,
          tokensCacheRead: null,
          costUsd: null,
          payload: null,
        },
      }),
      [],
      nowS,
    );
    assert(
      snapshot.evidenceLabel === "Last run",
      `freshest signal must be named, got '${snapshot.evidenceLabel}'`,
    );
    assert(
      snapshot.evidenceAt === (nowS - 2_400) * 1000,
      "evidence timestamp must be the run finish, not the handoff",
    );
  });

  check("a dispatch fresher than run and handoff names itself in the evidence", () => {
    const nowS = 1_700_000_000;
    const snapshot = buildProjectOperationsSnapshot(
      stubProject({
        tab: "orangecat",
        session: {
          done: "old",
          next: "",
          tests: "",
          todos: "",
          health: "",
          mtime: (nowS - 86_400) * 1000,
        },
        recentActivity: [
          {
            id: "a1",
            projectKey: "orangecat",
            at: new Date((nowS - 600) * 1000).toISOString(),
            kind: "dispatch",
            source: "user",
            displayText: "fix feedback",
            runId: null,
          } as ProjectState["recentActivity"][number],
        ],
      }),
      [],
      nowS,
    );
    assert(
      snapshot.evidenceLabel === "Last dispatch",
      `freshest signal must be named, got '${snapshot.evidenceLabel}'`,
    );
    assert(
      snapshot.evidenceAt === (nowS - 600) * 1000,
      "evidence timestamp must be the dispatch time",
    );
  });

  check("quiet process is labeled Agent idle without claiming it asked the user", () => {
    const nowS = 1_700_000_000;
    const project = stubProject({ tab: "Loki", agentRunning: true });
    const state = getProjectDisplayState(project, ["Loki"], nowS);
    const snapshot = buildProjectOperationsSnapshot(project, ["Loki"], nowS);
    assert(
      state.stateLabel === "Agent idle",
      "a quiet process must not be presented as an explicit request for input",
    );
    assert(snapshot.phase === "open_idle", "open_idle phase is still the underlying state");
    assert(snapshot.evidenceLabel === "Agent idle", "evidence label must match the badge wording");
  });

  check("ready sentinel is a next-step state, not generic waiting", () => {
    const nowS = 1_700_000_000;
    const project = stubProject({ tab: "Loki", readyAt: nowS - 5 });
    const state = getProjectDisplayState(project, ["Loki"], nowS);
    const snapshot = buildProjectOperationsSnapshot(project, ["Loki"], nowS);
    assert(state.stateLabel === "Ready for next step", "ready signal must name the action state");
    assert(snapshot.phase === "ready", "ready signal remains actionable");
    assert(
      snapshot.evidenceLabel === "Agent signaled ready on connected computer",
      "ready evidence should identify the signal",
    );
  });

  check("operations list prioritizes projects waiting for user action", () => {
    const nowS = 1_700_000_000;
    const snapshots = buildProjectOperationsSnapshots(
      [
        stubProject({
          tab: "Working",
          agentRunning: true,
          currentPrompt: { key: "custom", label: "Implementing", startedAt: nowS - 5 },
        }),
        stubProject({ tab: "Waiting", agentRunning: true, readyAt: nowS - 5 }),
        stubProject({ tab: "Stopped" }),
      ],
      ["Working", "Waiting"],
      nowS,
    );
    assert(
      snapshots.map(({ project }) => project.tab).join(",") === "Waiting,Working,Stopped",
      "actionable ordering expected",
    );
  });

  check("closing lifecycle takes precedence over an open process in the snapshot", () => {
    const nowS = 1_700_000_000;
    const snapshot = buildProjectOperationsSnapshot(
      stubProject({
        tab: "Closing",
        agentRunning: true,
        closingAt: nowS - 2,
      }),
      ["Closing"],
      nowS,
    );
    assert(snapshot.display.stateLabel === "Closing", "badge must report closing");
    assert(snapshot.phase === "closing", "rail phase must agree with the badge");
  });

  check("millisecond handoff mtime does not make a fresh prompt stale", () => {
    const nowS = 1_700_000_100;
    const project = stubProject({
      tab: "Loki",
      agentRunning: true,
      currentPrompt: { key: "custom", label: "Current work", startedAt: nowS - 10 },
      session: {
        done: "previous",
        next: "",
        tests: "",
        todos: "",
        health: "",
        mtime: (nowS - 20) * 1000,
      },
    });
    assert(!isCurrentPromptStale(project, nowS), "older handoff must not end current work");
    assert(
      getProjectDisplayState(project, ["Loki"], nowS).stateLabel === "Working",
      "fresh prompt must show Working",
    );
  });

  check("direct-terminal observation is surfaced as Working", () => {
    // Runner-side path for prompts the user typed directly into Claude (no
    // Loki dispatch sentinel). loki-daemon.sh sets currentPrompt.key to
    // "direct_terminal" with startedAt = the transcript's mtime when the tab is
    // open, no other prompt is tracked, and the agent has not just signaled
    // ready. The presenter must treat this exactly like any tracked prompt so
    // chips/badges read "Working" instead of falling through to "Agent shell
    // open" (the limitation 6da8d7e called out).
    const nowS = 1_700_000_100;
    const project = stubProject({
      tab: "Loki",
      agentRunning: true,
      activeAgents: ["claude"],
      currentPrompt: {
        key: "direct_terminal",
        label: "Direct terminal activity",
        startedAt: nowS - 3,
      },
    });
    const state = getProjectDisplayState(project, ["Loki"], nowS);
    assert(state.stateLabel === "Working", "direct-terminal observation must report Working");
    assert(state.isAgentWorking, "isAgentWorking is the SSOT chips read");
    const snapshot = buildProjectOperationsSnapshot(project, ["Loki"], nowS);
    assert(snapshot.phase === "working", "snapshot phase must match the badge");
    assert(
      snapshot.evidenceLabel === "Live agent process detected",
      "evidence must read live, not historical",
    );
  });

  check("working handoff does not stale an active prompt", () => {
    const nowS = 1_700_000_100;
    const project = stubProject({
      tab: "Loki",
      agentRunning: false,
      currentPrompt: { key: "custom", label: "Still implementing", startedAt: nowS - 30 },
      session: {
        status: "working",
        done: "partial",
        next: "finish",
        tests: "",
        todos: "",
        health: "good",
        mtime: (nowS - 5) * 1000,
      },
    });
    assert(!isCurrentPromptStale(project, nowS), "status:working handoff must not clear Working");
    assert(
      getProjectDisplayState(project, ["Loki"], nowS).stateLabel === "Working",
      "fresh prompt must show Working without agentRunning",
    );
  });

  check("handoff written after prompt marks it completed", () => {
    const nowS = 1_700_000_100;
    const project = stubProject({
      tab: "Loki",
      agentRunning: true,
      currentPrompt: { key: "custom", label: "Current work", startedAt: nowS - 20 },
      session: {
        done: "finished",
        next: "",
        tests: "",
        todos: "",
        health: "",
        mtime: (nowS - 5) * 1000,
      },
    });
    assert(isCurrentPromptStale(project, nowS), "newer handoff should end displayed work");
  });

  // Helper: recent runs (age 0) unless a specific age is given.
  const runs = (
    outcomes: Array<"error" | "hang" | "timeout" | "success" | "partial" | "user_abort">,
    ageMs = 0,
  ) => outcomes.map((outcome) => ({ outcome, ageMs }));

  check("fleet pulse: off → Paused regardless of outcomes", () => {
    const pulse = deriveFleetPulse({
      automationMode: "off",
      workingCount: 3,
      latestRuns: runs(["error", "error"]),
    });
    assert(pulse.key === "paused", "off must be paused");
  });

  check("fleet pulse: any working agent → Building", () => {
    const pulse = deriveFleetPulse({
      automationMode: "on",
      workingCount: 1,
      latestRuns: runs(["error", "error"]),
    });
    assert(pulse.key === "building", "working agents mean building even with past failures");
  });

  check("fleet pulse: 0 working + all RECENT runs failed → Stalled", () => {
    // The 2026-07-02 dead-fleet shape: autopilot on, nothing working, every
    // project's latest run a recent timeout — must NOT read "Building".
    const pulse = deriveFleetPulse({
      automationMode: "on",
      workingCount: 0,
      latestRuns: runs(["timeout", "timeout", "error"]),
    });
    assert(pulse.key === "failing", "all-failed fleet must surface as failing");
    assert(!!pulse.detail, "failing pulse carries a detail sentence");
  });

  check("fleet pulse: STALE failures (older than 24h) → Waiting, not Stalled", () => {
    // The box-credential outage shape: every latest run is a timeout, but they
    // all finished weeks ago and nothing has run since. Idle, not stalled.
    const old = 3 * 24 * 60 * 60 * 1000;
    const pulse = deriveFleetPulse({
      automationMode: "on",
      workingCount: 0,
      latestRuns: runs(["timeout", "timeout", "error"], old),
    });
    assert(pulse.key === "waiting", "old failures with no recent runs are idle, not a live stall");
  });

  check("fleet pulse: one failure among successes → Waiting, not Stalled", () => {
    const pulse = deriveFleetPulse({
      automationMode: "on",
      workingCount: 0,
      latestRuns: runs(["error", "success", "partial"]),
    });
    assert(pulse.key === "waiting", "a single failing project must not panic the hero");
  });

  check(
    "fleet pulse: 0 working, nothing queued, nobody waiting → Idle, not 'about to dispatch'",
    () => {
      const pulse = deriveFleetPulse({
        automationMode: "on",
        workingCount: 0,
        waitingCount: 0,
        latestRuns: [],
      });
      assert(pulse.key === "waiting", "quiet fleet with autopilot on is waiting, not building");
      assert(
        pulse.label === "Idle — nothing queued",
        "an empty quiet fleet must not promise an imminent dispatch",
      );
    },
  );

  check(
    "fleet pulse: projects awaiting input → 'Waiting on you', not 'Waiting to dispatch'",
    () => {
      // 2026-08-13: the hero read "Waiting to dispatch" while the queue was
      // empty and the only thing anyone waited on was the human — autopilot
      // deliberately does NOT interrupt a session that's awaiting input, so
      // the promised dispatch could never come.
      const pulse = deriveFleetPulse({
        automationMode: "on",
        workingCount: 0,
        waitingCount: 1,
        latestRuns: [],
      });
      assert(pulse.label === "Waiting on you", "the hero must name who is actually blocking");
      assert(
        !!pulse.detail && pulse.detail.includes("1 project"),
        "detail counts the projects awaiting input",
      );
    },
  );

  check("fleet pulse: user_abort is neutral, not a systemic failure", () => {
    const pulse = deriveFleetPulse({
      automationMode: "on",
      workingCount: 0,
      latestRuns: runs(["user_abort", "timeout"]),
    });
    assert(pulse.key === "waiting", "aborts are human choices — only real failures stall the hero");
  });

  check("fleet pulse: genuine execution stall outranks Building", () => {
    // 2026-08-13: "Building · 1 agent active" rendered directly above
    // "Builder is connected but not executing (2 queued 469s)" — both cannot
    // be true. An observed terminal process doesn't prove the dispatch
    // pipeline works; a real stall (already filtered of serialized/in-flight
    // commands server-side) must own the headline.
    const pulse = deriveFleetPulse({
      automationMode: "on",
      workingCount: 1,
      latestRuns: runs(["success"]),
      executionStall: { stalled: true, stalledCount: 2, oldestSeconds: 469, tabs: ["orangecat"] },
    });
    assert(pulse.key === "stalled", "stalled execution must not read as Building");
    assert(
      !!pulse.detail && pulse.detail.includes("orangecat"),
      "stall detail names the stuck projects",
    );
    assert(
      !!pulse.detail && pulse.detail.includes("8m"),
      "stall detail states the queue age in minutes",
    );
  });

  check("fleet pulse: non-stalled execution health leaves Building untouched", () => {
    const pulse = deriveFleetPulse({
      automationMode: "on",
      workingCount: 1,
      latestRuns: runs(["success"]),
      executionStall: { stalled: false, stalledCount: 0, oldestSeconds: 0, tabs: [] },
    });
    assert(pulse.key === "building", "healthy execution with a working agent is Building");
  });

  // ── Hook-reported agent turns ───────────────────────────────────────────
  // The regression: Control read "0 working · 21 idle" while eight agents were
  // mid-task, because every "working" signal required Loki to have
  // dispatched the run or the runner to recognise a zellij tab name. A session
  // started any other way was structurally invisible.

  check("an open agent turn alone makes a project working", () => {
    const state = getProjectDisplayState(
      stubProject({ tab: "petvity", liveAgentTurns: openTurn(3) }),
      [],
      Math.floor(Date.now() / 1000),
    );
    assert(state.isRunning, "an agent that reported a turn start is working");
    assert(state.tone === "running", `expected tone running, got ${state.tone}`);
  });

  check("no open turn leaves the old behaviour untouched", () => {
    const state = getProjectDisplayState(
      stubProject({ tab: "petvity", liveAgentTurns: null }),
      [],
      Math.floor(Date.now() / 1000),
    );
    assert(!state.isRunning, "no turn, no dispatch, no tab → not running");
    assert(state.tone === "idle", `expected tone idle, got ${state.tone}`);
  });

  check("verified run output makes a project working without a process match", () => {
    const state = getProjectDisplayState(
      stubProject({ tab: "loki", agentRunning: true, verifiedRunActive: true }),
      [],
      Math.floor(Date.now() / 1000),
    );
    assert(state.isRunning, "verified run output is active work");
    assert(state.isAgentWorking, "fleet counts must include the verified run");
    assert(state.tone === "running", `expected tone running, got ${state.tone}`);
  });

  check("an open idle process without verified run output stays idle", () => {
    const state = getProjectDisplayState(
      stubProject({ tab: "loki", agentRunning: true, verifiedRunActive: false }),
      [],
      Math.floor(Date.now() / 1000),
    );
    assert(!state.isRunning, "an open process alone does not prove work");
    assert(state.tone === "session-open", `expected session-open, got ${state.tone}`);
  });

  // Control showed "Working · Live agent process detected" for a project whose
  // own /api/control reported agentRunning=false and activeAgents=[] — the
  // badge was right (a hook turn was open) and the stated reason was invented.
  // Each running signal must name itself.
  check("a live agent turn is reported as a turn, not as a detected process", () => {
    const nowS = Math.floor(Date.now() / 1000);
    const project = stubProject({
      tab: "loki",
      agentRunning: false,
      activeAgents: [],
      liveAgentTurns: openTurn(2),
    });
    const state = getProjectDisplayState(project, ["loki"], nowS);
    assert(state.isRunning, "an open turn is work");
    assert(
      state.runningEvidence === "live-turn",
      `expected live-turn, got ${String(state.runningEvidence)}`,
    );
    const snapshot = buildProjectOperationsSnapshot(project, ["loki"], nowS);
    assert(
      snapshot.evidenceLabel === "Agent reported a turn in progress",
      `must not claim a process it never saw, got "${snapshot.evidenceLabel}"`,
    );
  });

  check("verified run output is reported as run output", () => {
    const nowS = Math.floor(Date.now() / 1000);
    const project = stubProject({
      tab: "loki",
      agentRunning: true,
      verifiedRunActive: true,
    });
    const state = getProjectDisplayState(project, ["loki"], nowS);
    assert(
      state.runningEvidence === "run-output",
      `expected run-output, got ${String(state.runningEvidence)}`,
    );
    const snapshot = buildProjectOperationsSnapshot(project, ["loki"], nowS);
    assert(
      snapshot.evidenceLabel === "Run output still arriving from the builder",
      `expected the run-output line, got "${snapshot.evidenceLabel}"`,
    );
  });

  check("a tracked prompt with no agent process says so", () => {
    const nowS = Math.floor(Date.now() / 1000);
    const project = stubProject({
      tab: "loki",
      agentRunning: false,
      activeAgents: [],
      currentPrompt: { key: "runner", label: "Dispatched work", startedAt: nowS - 3 },
    });
    const state = getProjectDisplayState(project, ["loki"], nowS);
    assert(state.isRunning, "a fresh tracked prompt still reads as work");
    assert(
      state.runningEvidence === "dispatched-prompt",
      `expected dispatched-prompt, got ${String(state.runningEvidence)}`,
    );
    const snapshot = buildProjectOperationsSnapshot(project, ["loki"], nowS);
    assert(
      !snapshot.evidenceLabel.includes("process detected"),
      `must not claim a process, got "${snapshot.evidenceLabel}"`,
    );
  });

  check("a count of 0 is not a live turn", () => {
    // The bucket only ever exists with count >= 1, but a future caller that
    // sends an empty bucket must not light the card up.
    const state = getProjectDisplayState(
      stubProject({
        tab: "petvity",
        liveAgentTurns: { count: 0, startedAt: new Date().toISOString(), cwds: [] },
      }),
      [],
      Math.floor(Date.now() / 1000),
    );
    assert(!state.isRunning, "count 0 must not read as working");
  });

  check("an open turn outranks a recent ready stamp", () => {
    // readyAt says the agent finished a turn; a new turn means it is working
    // again. Without this the card sits on "Ready" through the whole next turn
    // and the project lands in the awaiting-you bucket while an agent edits it.
    const nowS = Math.floor(Date.now() / 1000);
    const state = getProjectDisplayState(
      stubProject({ tab: "vitareba", readyAt: nowS - 5, liveAgentTurns: openTurn(1) }),
      [],
      nowS,
    );
    assert(!state.isReady, "a started turn cancels the ready state");
    assert(state.tone === "running", `expected running, got ${state.tone}`);
  });

  check("a ready stamp still wins when no turn is open", () => {
    const nowS = Math.floor(Date.now() / 1000);
    const state = getProjectDisplayState(
      stubProject({ tab: "vitareba", readyAt: nowS - 5, liveAgentTurns: null }),
      [],
      nowS,
    );
    assert(state.isReady, "ready must survive when nothing is running");
  });

  check("bucketTurnsByProject: counts, oldest start, deduped cwds", () => {
    const iso = (m: number) => new Date(Date.UTC(2026, 7, 16, 12, m));
    const bucketed = bucketTurnsByProject([
      { projectKey: "loki", cwd: "/dev/loki/.claude/worktrees/a", startedAt: iso(30) },
      { projectKey: "loki", cwd: "/dev/loki/.claude/worktrees/b", startedAt: iso(10) },
      { projectKey: "loki", cwd: "/dev/loki/.claude/worktrees/a", startedAt: iso(50) },
      { projectKey: "petvity", cwd: "/dev/petvity", startedAt: iso(20) },
    ]);
    assert(bucketed.loki.count === 3, "three open turns on loki");
    assert(
      bucketed.loki.startedAt === iso(10).toISOString(),
      "the OLDEST open turn is reported, not the newest",
    );
    assert(bucketed.loki.cwds.length === 2, "repeated cwds are deduped");
    assert(bucketed.petvity.count === 1, "petvity counted separately");
    assert(Object.keys(bucketed).length === 2, "no phantom projects");
  });

  // ---- the fleet triad must never be invented ----
  //
  // Without runtime state every project classifies as `offline`, so the triad
  // reads 0/0/0 — which is byte-for-byte the "All clear" condition. Control
  // would therefore announce a calm fleet at the exact moment it knows nothing
  // about it, on the surface whose whole job is saying what needs the operator.
  // countsKnown is how the derivation layer says "I don't know yet".
  const controlData = (projects: ProjectState[], liveTabs: string[] = []) =>
    ({
      projects,
      liveTabs,
      inventory: {
        source: "user_projects",
        trackedProjectCount: projects.length,
        controlProjectCount: projects.length,
        linkedDirectoryCount: 0,
      },
    }) as unknown as Parameters<typeof buildControlPageState>[0];

  check("countsKnown is false before the runner has ever reported", () => {
    const data = controlData([stubProject({ tab: "alpha" }), stubProject({ tab: "beta" })]);
    const state = buildControlPageState(data, Math.floor(Date.now() / 1000), false, false);
    assert(state.dashboard.countsKnown === false, "counts must not claim to be known");
  });

  check("countsKnown is true once runtime state is known", () => {
    const data = controlData([stubProject({ tab: "alpha" })]);
    const state = buildControlPageState(data, Math.floor(Date.now() / 1000), true, false);
    assert(state.dashboard.countsKnown === true, "counts are knowable once the runner reported");
  });

  check("unknown runtime state yields 0/0/0 — the same shape as 'All clear'", () => {
    // The reason countsKnown has to exist. With runtime state unknown the triad
    // is not a partial count, it is indistinguishable from a healthy quiet
    // fleet. If this ever stops being true, revisit whether countsKnown is
    // still load-bearing rather than deleting it silently.
    const projects = [
      stubProject({ tab: "alpha" }),
      stubProject({ tab: "beta" }),
      stubProject({ tab: "gamma" }),
    ];
    const nowS = Math.floor(Date.now() / 1000);
    const unknown = buildControlPageState(controlData(projects), nowS, false, false).dashboard;
    assert(unknown.runningCount === 0, "nothing can be known to be working");
    assert(unknown.waitingCount === 0, "nothing can be known to be waiting");
    assert(unknown.idleCount === 0, "nothing can be known to be idle either");

    // ...and the same fleet, once known, is NOT all-clear.
    const known = buildControlPageState(controlData(projects), nowS, true, false).dashboard;
    assert(known.idleCount === projects.length, "known state buckets them as idle");
  });

  console.log(`\n${passed}/${passed} passed`);
}

runTests();
