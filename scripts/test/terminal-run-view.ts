/**
 * Terminal Loki rail: commentary from work-phase, not a log dump; quota death
 * offers Claude Code / Codex / Cursor / Grok / Antigravity and hides the dead agent.
 *
 * Run: npx tsx scripts/test/terminal-run-view.ts
 */
import assert from "node:assert/strict";
import {
  buildTerminalRunView,
  nextActionForWork,
  presentTerminalRun,
  quotaDeathAlternatives,
} from "@/lib/terminal-run-view";
import { FEEDBACK_WORK_PHASE, WAITING_ON, type FeedbackWorkView } from "@/lib/feedback/work-phase";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { QUOTA_ALTERNATIVE_AGENTS } from "@/config/quota-alternatives";
import {
  capacityFailureFromScreen,
  shouldReplacePtyAgent,
} from "../../desktop/src/main/pty-runtime";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const work = (over: Partial<FeedbackWorkView> = {}): FeedbackWorkView => ({
  phase: FEEDBACK_WORK_PHASE.WORKING,
  waitingOn: WAITING_ON.MACHINE,
  label: "Working · 2 min",
  detail: null,
  stepSummary: "Agent is working",
  ...over,
});

check("quota language on the diagnostic is quota death", () => {
  const alts = quotaDeathAlternatives({
    diagnostic: "Claude rate limit: out of tokens until reset",
    currentAgent: "claude",
  });
  assert.ok(alts);
  assert.deepEqual(
    alts.map((a) => a.id),
    ["codex", "cursor", "grok", "gemini"],
  );
  assert.equal(alts.find((a) => a.id === "gemini")?.label, "Antigravity");
  assert.equal(
    alts.some((a) => a.id === "claude" || a.label === "Hermes"),
    false,
    "dead agent and Hermes stay out of the chooser",
  );
});

check("the dead agent is hidden from the chooser", () => {
  const alts = quotaDeathAlternatives({
    error: "insufficient quota",
    currentAgent: "grok",
  });
  assert.ok(alts);
  assert.equal(
    alts.some((a) => a.id === "grok"),
    false,
  );
  assert.ok(alts.some((a) => a.id === "cursor"));
});

check("silence is not quota death", () => {
  assert.equal(quotaDeathAlternatives({ diagnostic: "Waiting for first output" }), null);
  assert.equal(quotaDeathAlternatives({ diagnostic: null, error: null }), null);
});

check("a quota redraw is a blocker, not generation evidence", () => {
  assert.match(
    capacityFailureFromScreen("Weekly limit left: 0% · Grok 4.6", "grok") ?? "",
    /usage limit is exhausted/,
  );
  assert.equal(capacityFailureFromScreen("Thinking…", "grok"), null);
});

check("Retry replaces a live PTY when the project provider changed", () => {
  assert.equal(shouldReplacePtyAgent("grok", "cursor"), true);
  assert.equal(shouldReplacePtyAgent("cursor", "cursor"), false);
  assert.equal(shouldReplacePtyAgent(null, "cursor"), false);
});

check("next action prefers the queue reason over a badge", () => {
  assert.equal(
    nextActionForWork(
      work({
        queueReason: "Cloud builder offline — open Fleet Runner",
        detail: "Retry",
      }),
    ),
    "Cloud builder offline — open Fleet Runner",
  );
});

check("quota death overrides the queue reason with a chooser sentence", () => {
  assert.match(nextActionForWork(work({ queueReason: "Retry" }), true), /Claude Code|Codex|Grok/);
});

check("the view is phase + next action, not an event trail", () => {
  const view = buildTerminalRunView({
    runId: "run-1",
    projectKey: "loki",
    work: work({
      phase: FEEDBACK_WORK_PHASE.STUCK,
      waitingOn: WAITING_ON.YOU,
      label: "Stalled",
      detail: "Retry or Watch",
      diagnostic: "rate limit: out of tokens",
      lastActivityAt: "2026-09-16T10:00:00.000Z",
    }),
    currentAgent: "claude",
    error: "rate limit",
  });
  assert.equal(view.runId, "run-1");
  assert.equal(view.stalled, true);
  assert.equal(view.quotaDeath, true);
  assert.equal(view.alternatives.length, 4);
  assert.match(view.nextAction, /Claude Code|Codex|Antigravity|Grok|Cursor/);
  assert.equal("events" in view, false);
});

check("an open run never claims generation after its PTY is gone", () => {
  const view = buildTerminalRunView({
    runId: "run-stale",
    projectKey: "substrata",
    work: work(),
  });
  assert.deepEqual(presentTerminalRun(view, false), {
    label: "Session ended",
    stepSummary: "No live terminal session",
    nextAction:
      "The run record is still open, but its agent terminal is gone. Start this project again or return to Feedback and Retry.",
  });
  assert.equal(presentTerminalRun(view, true).label, "Working · 2 min");
});

check("empty Terminal names Fleet Runner vs Kitty", () => {
  assert.match(EXECUTOR_COPY.terminal.cloudEmptyHint, /Kitty/);
  assert.match(EXECUTOR_COPY.terminal.cloudEmptyHint, /Fleet Runner/);
  assert.match(EXECUTOR_COPY.terminal.thisComputerEmptyHint, /Kitty/);
  assert.match(EXECUTOR_COPY.terminal.thisComputerEmptyHint, /Fleet Runner/);
});

check("quota chooser is all coding agents, never Hermes", () => {
  assert.deepEqual(
    QUOTA_ALTERNATIVE_AGENTS.map((a) => a.id),
    ["claude", "codex", "cursor", "grok", "gemini"],
  );
  assert.equal(QUOTA_ALTERNATIVE_AGENTS.find((a) => a.id === "gemini")?.label, "Antigravity");
  assert.equal(QUOTA_ALTERNATIVE_AGENTS.find((a) => a.id === "claude")?.label, "Claude Code");
  assert.equal(
    QUOTA_ALTERNATIVE_AGENTS.some((a) => a.id === "hermes" || a.label === "Hermes"),
    false,
  );
});

check("Watch and Terminal share the run id in the deep link", () => {
  const href = fleetSurfaceHref(
    "terminal",
    "Loki",
    undefined,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
  assert.equal(href, "/terminal?project=Loki&run=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  const withSource = fleetSurfaceHref(
    "terminal",
    "Loki",
    "cloud",
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
  assert.equal(
    withSource,
    "/terminal?project=Loki&source=cloud&run=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
});

console.log(`\n${passed} checks passed`);
