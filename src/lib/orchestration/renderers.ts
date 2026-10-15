import { getOrchestrationIntent } from "./intents";
import type { AdapterId, OrchestrationTaskRequest } from "./contract";
import { PROMPT_TEMPLATES } from "@/config/prompt-library";

/** SSOT autopilot prompts: keyed by intent ID, value is the template body
 *  from prompt-library.ts (the canonical source where the body lives,
 *  including Session 5's role + self-throttle + worked-examples refinements).
 *  Built lazily so the import order isn't load-bearing. */
let _autopilotBodies: Map<string, string> | null = null;
function autopilotBody(intentKey: string): string | null {
  if (!_autopilotBodies) {
    _autopilotBodies = new Map();
    for (const t of PROMPT_TEMPLATES) {
      if (t.agentKey) _autopilotBodies.set(t.agentKey, t.template);
    }
  }
  return _autopilotBodies.get(intentKey) ?? null;
}

function renderSharedHandoffBlock(): string {
  return [
    "Update the session handoff when finished:",
    "status: ready | working",
    "done: one sentence",
    "next: state to resume from, or empty when finished",
    "tsc: pass | fail",
    "lint: pass | fail",
    "tests: pass/fail counts, or no suite",
    "todos: count",
    "commit: short SHA, or none",
  ].join("\n");
}

function renderSharedExecutionRules(): string {
  return [
    "Use first principles. Prefer the simplest correct change.",
    "Follow SSOT, SoC, DRY, YAGNI, and KISS.",
    "Do not stop at analysis if tool-driven execution can move the work forward.",
    "Verify meaningful changes with the smallest useful gate: tests, typecheck, lint, build, browser flow, or direct inspection.",
    "No scope creep. Pick the highest-impact next step and finish it fully unless blocked.",
  ].join("\n");
}

function renderIntentBody(request: OrchestrationTaskRequest): string {
  // Autopilot intents (next_best / test_and_fix / quality) read their body
  // from prompt-library.ts as the SSOT — same source the /control palette
  // UI and (formerly) the bash bridge used. Session 5 of killing-the-bash-
  // runner (2026-06-11) added the role line + self-throttle primitive +
  // worked examples to those bodies; without this lookup, autopilot fires
  // through Fleet Runner's /api/inject would still get the old generic
  // body (caught live when an autopilot fire delivered the pre-Session-5
  // text post-deploy). Other intents fall through to their inline cases.
  const fromLibrary = autopilotBody(request.intent);
  if (fromLibrary !== null) {
    // The library bodies don't interpolate projectPath the way the inline
    // ones did — but they do reference <P> patterns that work generically.
    // Prepend the project-path line for adapter context, then the body.
    return `Work on the project at ${request.projectPath}.\n\n${fromLibrary}`;
  }

  switch (request.intent) {
    case "test_and_fix":
      return [
        `Run the full test and fix loop for ${request.projectPath}.`,
        "Run relevant tests first.",
        "Then inspect the primary user flows and fix the highest-value failures.",
        "If tests pass and flows look healthy, improve coverage for the most critical missing path.",
      ].join("\n");
    case "quality":
      return [
        `Run a code-quality pass for ${request.projectPath}.`,
        "Do not add new features.",
        "Reduce duplication, tighten SSOT boundaries, remove obvious debt, and simplify overgrown code.",
      ].join("\n");
    case "full_audit":
      return [
        `Run a comprehensive audit for ${request.projectPath}.`,
        "Check tests, types, TODO debt, incomplete features, and architectural rough edges.",
        "Create a priority list by user impact, then execute the top item fully.",
      ].join("\n");
    case "product":
      return [
        `Review ${request.projectPath} as a product owner.`,
        "Find the highest-leverage product improvement based on user pain, clarity, and impact this week.",
        "Then apply one concrete improvement.",
      ].join("\n");
    case "ux_review":
      return [
        `Review the UX of ${request.projectPath}.`,
        "Check readability, mobile behavior, empty/loading/error states, visual hierarchy, and interaction clarity.",
        "Fix the top issues you find.",
      ].join("\n");
    case "deploy_check":
      return [
        `Run a pre-deploy verification pass for ${request.projectPath}.`,
        "Check type safety, build health, tests, validation, secrets hygiene, incomplete features, and obvious security risks.",
        "Fix blockers before declaring the project ready.",
      ].join("\n");
    case "commit_push":
      return [
        `Prepare and ship the current work in ${request.projectPath}.`,
        "Verify quality first, then review the diff, create a conventional commit that explains why, and push.",
        "If deployment applies, monitor it and report the result.",
      ].join("\n");
    case "close_session":
      return [
        `Close the current work session for ${request.projectPath}.`,
        "Ensure the working tree is in a safe state, run quality checks, note test results, and leave a clean handoff.",
      ].join("\n");
    case "hard_stop":
      return 'HARD STOP. Stop all work immediately. Do not run any more tools. Do not write any code. Do not make any changes. Say only "Stopped." and stop.';
    case "continue":
      return [
        `Continue the current work in ${request.projectPath}.`,
        "Resolve the pending question using the available context and keep going without bouncing the same blocker back to the user.",
      ].join("\n");
    case "custom":
      return request.customInstructions?.trim() ?? "";
  }
  // Unreachable: all OrchestrationTaskIntentId values are either handled
  // above or routed through the autopilotBody() lookup at the top. Kept as
  // a defensive fallback so the function has an unconditional return.
  return `Work on the project at ${request.projectPath}.`;
}

/** Explicit user tasks stay short; repo-local instructions are already read by the agent. */
export function renderDirectTask(customInstructions: string): string {
  return `## Task\n${customInstructions.trim()}`;
}

// Surface the user's prompt queue in the dispatched prompt. The agent now
// sees what's pending and can weigh queue items against other scanning
// candidates (interrupted work, failing tests, etc). Without this block,
// the queue is invisible to the agent — the renderer only fires queue[0]
// AS the prompt when handleAutoInject drains it, but the rest of the
// queue (and any context about "the user explicitly queued X, Y, Z")
// never reaches the model. Model-agnostic: every adapter that calls
// renderTaskForAdapter gets the same context block.
function renderQueueBlock(queue?: string[]): string | null {
  if (!queue || queue.length === 0) return null;
  const lines = queue.slice(0, 10).map((item, i) => `${i + 1}. ${item}`);
  const overflow = queue.length > 10 ? `\n…and ${queue.length - 10} more` : "";
  return [
    `User's prompt queue for this project (in priority order):`,
    ...lines,
    overflow,
    `Weigh these against the scanning candidates below — pick what's truly highest-impact right now.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The project's brief + active goals (the roadmap). Placed FIRST in the prompt
 *  so the agent reads what the project is trying to achieve before it decides
 *  the highest-impact next step. Null when the project has no context yet. */
export function renderProjectContextBlock(projectContext?: string): string | null {
  if (!projectContext || !projectContext.trim()) return null;
  return [
    `Project context & goals (what this project is trying to achieve):`,
    projectContext.trim(),
    `Favor the next step that most advances these goals.`,
  ].join("\n");
}

export function renderTaskForAdapter(
  request: OrchestrationTaskRequest,
  adapter: AdapterId = request.adapter,
): string {
  const intent = getOrchestrationIntent(request.intent);
  if (request.intent === "custom") {
    return renderDirectTask(request.customInstructions ?? "");
  }
  const queueBlock = renderQueueBlock(request.queue);
  const contextBlock = renderProjectContextBlock(request.projectContext);

  // Claude adapter: CLAUDE.md is always loaded in the session and already contains
  // execution rules and project context. Emit only the intent body — no redundant
  // header or rules. buildPromptWithSession appends the session file + update instruction.
  if (adapter === "claude") {
    const sections: string[] = [];
    if (contextBlock) sections.push(contextBlock);
    sections.push(renderIntentBody(request));
    if (queueBlock) sections.push(queueBlock);
    if (request.customInstructions?.trim()) {
      sections.push(`Additional instructions:\n${request.customInstructions.trim()}`);
    }
    return sections.join("\n\n");
  }

  const sections = [
    `Intent: ${intent.name}`,
    `Project: ${request.projectKey}`,
    ...(contextBlock ? [contextBlock] : []),
    renderIntentBody(request),
    renderSharedExecutionRules(),
  ];

  if (queueBlock) sections.push(queueBlock);

  if (request.customInstructions?.trim()) {
    sections.push(`Additional instructions:\n${request.customInstructions.trim()}`);
  }

  // Claude and Codex receive the specific session-file path via buildPromptWithSession,
  // so the generic block would be a duplicate. OpenClaw uses this render output directly.
  if (intent.requiresSessionHandoff && adapter === "openclaw") {
    sections.push(renderSharedHandoffBlock());
  }

  if (adapter === "openclaw") {
    sections.push(
      "Use OpenClaw-native tools and durable execution patterns where they reduce manual busywork.",
    );
  }

  return sections.join("\n\n");
}
