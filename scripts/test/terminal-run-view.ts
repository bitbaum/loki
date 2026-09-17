/**
 * Terminal Loki rail: commentary from work-phase, not a log dump. Quota death is
 * now a FLAG here — which providers to offer, in what order, and whether each
 * can actually answer belongs to src/lib/provider-switch.ts and its own suite.
 *
 * Run: npx tsx scripts/test/terminal-run-view.ts
 */
import assert from "node:assert/strict";
import {
  buildTerminalRunView,
  isQuotaDeath,
  nextActionForWork,
  presentTerminalRun,
} from "@/lib/terminal-run-view";
import { FEEDBACK_WORK_PHASE, WAITING_ON, type FeedbackWorkView } from "@/lib/feedback/work-phase";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { QUOTA_ALTERNATIVE_AGENTS } from "@/config/quota-alternatives";
import {
  capacityFailureFromScreen,
  shouldReplacePtyAgent,
} from "../../desktop/src/main/pty-runtime";
import { AGENT_FALLBACK_ORDER } from "@/lib/agent-resolution";

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
  assert.equal(isQuotaDeath({ diagnostic: "Claude rate limit: out of tokens until reset" }), true);
  assert.equal(isQuotaDeath({ error: "insufficient quota" }), true);
});

check("silence is not quota death", () => {
  assert.equal(isQuotaDeath({ diagnostic: "Waiting for first output" }), false);
  assert.equal(isQuotaDeath({ diagnostic: null, error: null }), false);
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

check("quota death overrides the queue reason, without naming providers", () => {
  const line = nextActionForWork(work({ queueReason: "Retry" }), true);
  assert.match(line, /switch to a provider/i);
  // The rail's own chooser says WHICH — a sentence that named them went stale
  // the moment the chooser started filtering to what is installed.
  assert.doesNotMatch(line, /Claude Code|Codex|Cursor|Grok|Antigravity/);
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
    error: "rate limit",
  });
  assert.equal(view.runId, "run-1");
  assert.equal(view.stalled, true);
  assert.equal(view.quotaDeath, true);
  assert.equal("alternatives" in view, false, "the ranking belongs to /api/providers now");
  assert.match(view.nextAction, /switch to a provider/i);
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
  // Membership, not sequence: the chooser's ORDER is now the operator's
  // preference (user_preferences.agent_order), and the list is derived from
  // AGENT_FALLBACK_ORDER so the two can never disagree about which agents exist.
  assert.deepEqual([...QUOTA_ALTERNATIVE_AGENTS.map((a) => a.id)].sort(), [
    "claude",
    "codex",
    "cursor",
    "gemini",
    "grok",
  ]);
  assert.deepEqual(
    QUOTA_ALTERNATIVE_AGENTS.map((a) => a.id),
    [...AGENT_FALLBACK_ORDER],
    "derived from the fallback order, not a second hand-written list",
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
