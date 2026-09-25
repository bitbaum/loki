import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ORCH_STATE } from "@/lib/orchestration/contract";
import { spawn } from "node:child_process";
import path from "node:path";
import { isRuntimeAvailable } from "@/lib/runtime";
import { deriveProjectStateKey, projectStateDescription } from "@/lib/control-states";

import { readJsonBody, z } from "@/lib/api/route-helpers";
import { injectOwned, listOwnedTabs } from "@/lib/agent-execution/owned";
import { AGENT_DEFAULT_MODELS } from "@/lib/agent-registry";
import {
  buildPromptWithSession,
  resolveEffectiveTab,
  stateFile,
  clearHandshakeFiles,
  exitContractFor,
} from "@/lib/agent-config";
import { FLEET_SESSIONS_DISPLAY_PATH } from "@/lib/session-paths";
import { planParallelRun, type ParallelRunPlan } from "@/lib/orchestration/parallel-run";
import {
  ORCHESTRATION_ADAPTER_IDS,
  ORCHESTRATION_TASK_INTENT_IDS,
  type AdapterId,
  type OrchestrationEventType,
  type OrchestrationTaskIntentId,
  type OrchestrationTaskRequest,
} from "@/lib/orchestration";
import {
  getAdapterDefinition,
  getOrchestrationIntent,
  renderTaskForAdapter,
} from "@/lib/orchestration";
import { createOrchestrationEvent } from "@/db/queries/orchestration-events";
import {
  createOrchestrationRun,
  updateOrchestrationRun,
  isProjectBusy,
} from "@/db/queries/orchestration-runs";
import { insertPromptHistory } from "@/db/queries/prompt-history";
import {
  consumeProjectPrompt,
  getProjectState,
  persistProjectRuntimeIfNewer,
  prependProjectPrompt,
} from "@/db/queries/project-states";
import { getApiActor } from "@/lib/session";
import { AttachmentsField, foldAttachmentsIntoPrompt } from "@/lib/composer-attachments";
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import { getProjectContext } from "@/db/queries/project-context";
import { buildOperatorContextSection } from "@/lib/dispatch-operator-context";
import { enqueueDispatchCommand } from "@/db/queries/pending-commands";
import { getBuilderPresence } from "@/db/queries/runner-presence";
import { logDebug } from "@/db/queries/debug-logs";
import { APP_SLUG } from "@/config/brand";
import { writePromptQueueMirror } from "@/lib/prompt-queue-mirror";
import {
  executionAccessErrorBody,
  resolveQueuedExecution,
  pickDispatchChannel,
} from "@/lib/execution-access";
import { workspaceIdFor } from "@/lib/agent-execution/ownership";
import { shouldAnnounceOnClose } from "@/lib/orchestration/notify-close-format";

/** Same-project parallel dispatch (phase 2 of worktree-per-agent): when a
 *  project is busy, dispatch immediately under a derived tab alias instead of
 *  queueing behind. Requires worktree isolation on the runner (the runner
 *  force-isolates derived tabs, so this can't create shared-checkout races).
 *  Default off — flip after the worktree flag has been dogfooded. */

const RunOrchestrationBody = z.object({
  projectId: z.string().uuid().nullable().optional(),
  projectKey: z.string().trim().min(1).max(120),
  // Optional: when omitted (e.g. Loki's loki_dispatch by name), the server
  // resolves projectPath + adapter from the user's project registry.
  projectPath: z.string().trim().min(1).max(500).optional(),
  adapter: z.enum(ORCHESTRATION_ADAPTER_IDS).optional(),
  intent: z.enum(ORCHESTRATION_TASK_INTENT_IDS),
  model: z.string().trim().max(160).optional(),
  customInstructions: z.string().trim().max(4000).optional(),
  /** Screenshots and text files staged in the composer — see
   *  lib/composer-attachments for why an image becomes text before it ships. */
  attachments: AttachmentsField,
  // Optional database-backed queue snapshot from the client. Plumbed into
  // the prompt body via renderTaskForAdapter so the agent
  // can weigh queue items against other candidates. Max 200 items × 4kB
  // matches the persistence limit in /api/beacon/queue/[tab].
  queue: z.array(z.string().max(4000)).max(200).optional(),
});

type RunOrchestrationInput = z.infer<typeof RunOrchestrationBody>;
type ResolvedIntent = ReturnType<typeof getOrchestrationIntent>;

async function scheduleOpenClawWorker(
  runId: string,
  userId: string,
  request: OrchestrationTaskRequest,
) {
  const workerPath = path.join(process.cwd(), "scripts", "run-openclaw-orchestration.ts");
  // userId in the payload so the worker can emit task_completed/task_failed
  // to orchestration_events (user_id is NOT NULL on that table).
  const payload = Buffer.from(JSON.stringify({ runId, userId, request }), "utf8").toString(
    "base64url",
  );
  const command = `cd ${JSON.stringify(process.cwd())} && set -a && source .env.local >/dev/null 2>&1 && npx tsx ${JSON.stringify(workerPath)} ${JSON.stringify(payload)}`;
  const child = spawn("bash", ["-lc", command], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Worker spawn timeout")), 2000);
    child.on("spawn", () => {
      clearTimeout(timer);
      child.unref();
      resolve();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Every project the user can dispatch to — own registry plus their org's. */
async function listDispatchableProjects(userId: string) {
  return [
    ...(await getUserProjects(userId).catch(() => [])),
    ...(await getOrgProjects(userId).catch(() => [])),
  ];
}

async function findRegistryProject(userId: string, projectKey: string) {
  return (await listDispatchableProjects(userId)).find(
    (p) => p.name.toLowerCase() === projectKey.toLowerCase(),
  );
}

/** The one-line WHY the human sees on the state badge, threaded into the agent's
 *  prompt from the same SSOT (STATE_DEFINITIONS[k].description) — no paraphrasing. */
async function describeProjectState(userId: string, projectKey: string): Promise<string> {
  const row = await getProjectState(userId, projectKey).catch(() => null);
  const stateKey = deriveProjectStateKey({
    agentRunning: row?.agentRunning,
    tabOpen: row?.tabOpen,
    sessionStatus: row?.sessionStatus,
    readyAt: row?.readyAt ? Math.floor(row.readyAt.getTime() / 1000) : null,
    lockAt: row?.lockAt ? Math.floor(row.lockAt.getTime() / 1000) : null,
    closingAt: row?.closingAt ? Math.floor(row.closingAt.getTime() / 1000) : null,
    closedAt: row?.closedAt ? Math.floor(row.closedAt.getTime() / 1000) : null,
  });
  return projectStateDescription(stateKey);
}

/** Resolve projectPath + adapter from the registry when omitted (Loki dispatches
 *  by name). Mirrors inject-core's lookup; mutates `data` in place because every
 *  downstream branch reads it. Returns a 404 response when the name is unknown. */
async function resolveProjectDefaults(
  data: RunOrchestrationInput,
  userId: string,
): Promise<NextResponse | null> {
  if (data.projectPath && data.adapter) return null;
  const match = await findRegistryProject(userId, data.projectKey);
  if (!data.projectPath) {
    if (!match?.dirPath) {
      return NextResponse.json(
        { error: `Unknown project "${data.projectKey}" (or it has no local path).` },
        { status: 404 },
      );
    }
    data.projectPath = match.dirPath;
    data.projectId = data.projectId ?? match.entityProjectId ?? null;
  }
  if (!data.adapter) {
    data.adapter = (match?.agentPref as (typeof ORCHESTRATION_ADAPTER_IDS)[number]) ?? "openclaw";
  }
  return null;
}

/** Cloud mode: only the claude adapter can be queued via pending_commands.
 *  Other adapters (openclaw, codex, gemini) require local workers/tools. */
async function dispatchViaCloudQueue(
  request: OrchestrationTaskRequest,
  userId: string,
  announceOnClose: boolean,
): Promise<NextResponse> {
  if (!getAdapterDefinition(request.adapter).capabilities.cloudQueueable) {
    return NextResponse.json(
      {
        error: `${request.adapter} orchestration requires the local runtime — not available in cloud mode`,
      },
      { status: 503 },
    );
  }
  // Project-aware default channel — a dirPath-only project (no cloneable
  // repo) can only execute where its directory exists; pin it to "local"
  // instead of letting the cloud builder invent an empty workspace.
  const registryMatch = await findRegistryProject(userId, request.projectKey);
  const execution = await resolveQueuedExecution(userId, { project: registryMatch });
  if (!execution.ok) {
    return NextResponse.json(executionAccessErrorBody(execution), { status: execution.status });
  }
  const intent = getOrchestrationIntent(request.intent as OrchestrationTaskIntentId);
  // Aim the agent at the project's roadmap: brief + active goals (getProjectContext).
  request.projectContext = (await getProjectContext(userId, request.projectKey)) ?? undefined;
  // Life-OS half: the operator's top-level goals + near-term deadlines, so this
  // cloud-queued dispatch serves the captain's objectives too (mirrors the
  // inject-prompt/inject-core paths). Best-effort background section.
  const operatorSection = await buildOperatorContextSection(userId).catch(() => "");
  // Exit contract — WITHOUT it a box-executed agent finishes real work, writes
  // no ~/.loki/sessions/<tab>.md handoff, and gets reaped as a timeout (the
  // same gap inject-prompt.ts:66-74 closes for the inject path). The local
  // orchestration path gets this via buildPromptWithSession; the cloud path —
  // Control's dispatch / Next-best buttons — was the one bypass. Appended here
  // (renderTaskForAdapter does not include it) so every dispatch path lands a
  // handoff. Tilde-relative on purpose: the agent expands HOME, not the server.
  const sessionFileRef = `${FLEET_SESSIONS_DISPLAY_PATH}/${request.projectKey}.md`;
  const prompt = `${[operatorSection, renderTaskForAdapter(request)].filter(Boolean).join("\n\n")}\n\n${exitContractFor(sessionFileRef)}`;
  const cloudRunId = await createCloudTrackedRun(request, userId, announceOnClose);
  // Enqueue a `dispatch` (not bare `inject`): the runner ensures the tab,
  // launches the agent if none is running, then injects — so "Next best" on
  // an idle project actually starts work instead of typing into the void.
  // Model is forwarded so the runner's auto-launch honors it; when absent the
  // runner's _conf_model_for_tab fallback reads agent-projects.conf.
  const commandId = await enqueueDispatchCommand(userId, {
    tab: request.projectKey,
    ...(execution.channel ? { channel: execution.channel } : {}),
    dir: request.projectPath,
    agent: request.adapter,
    prompt,
    promptKey: request.intent,
    promptLabel: intent.name,
    model: request.model,
    projectKey: request.projectKey,
    runId: cloudRunId ?? undefined,
  });
  return NextResponse.json({
    ok: true,
    queued: true,
    mode: "queued",
    commandId,
    runId: cloudRunId,
    runnerConnected: execution.runnerConnected,
    // Fail loud, not silent — a dispatch with no live runner says so.
    ...(execution.runnerConnected === false && {
      warning: "runner-offline",
      message: "Fleet Runner is offline — queued; it will run as soon as the runner reconnects.",
    }),
  });
}

/** Create an orchestration_runs row for trackable intents so the local runner
 *  can write /tmp/cockpit-run-<tab> and agent-hook-bridge.sh can close out the
 *  outcome when the agent session ends. Lifecycle intents (hard_stop /
 *  close_session) end sessions and don't produce work outcomes — skip tracking. */
async function createCloudTrackedRun(
  request: OrchestrationTaskRequest,
  userId: string,
  announceOnClose: boolean,
): Promise<string | null> {
  if (request.intent === "hard_stop" || request.intent === "close_session") return null;
  try {
    const run = await createOrchestrationRun({
      userId,
      projectId: request.projectId ?? null,
      adapter: request.adapter,
      intent: request.intent,
      // The runner has not executed this command yet. Runtime state will
      // show active work only after a successful local injection.
      state: ORCH_STATE.WAITING,
      projectKey: request.projectKey,
      projectPath: request.projectPath,
      payload: {
        projectId: request.projectId ?? null,
        projectKey: request.projectKey,
        projectPath: request.projectPath,
        model: request.model,
        // Cloud mode: the operator dispatched and will almost certainly
        // stop watching — announce the outcome when it closes. Autopilot
        // (Bearer token) stays silent, which is what the original
        // "UI dispatches stay silent" rule was actually protecting.
        ...(announceOnClose ? { notifyOnClose: true } : {}),
      },
    });
    return run.id;
  } catch (err) {
    console.error("[orchestration/run] cloud tracked-run create failed:", err);
    // Non-fatal — dispatch still proceeds without outcome tracking.
    return null;
  }
}

/** For tab-injected adapters: prioritize the prompt queue for next_best intent.
 *  openclaw uses a worker process, not tab injection, so it does not participate in the queue.
 *  This matches the stop-hook behavior and prevents AI-generated plans from superseding
 *  user-defined queue items during auto-fire or manual 'Next best' clicks.
 *  Health gate mirrors sessionHealthBlocksQueue() on the client: if session health is critical
 *  or tests are failing, skip queue pop so the agent picks the recovery task instead.
 *  Mutates `request` into a custom dispatch and returns the item it consumed. */
async function popQueuedPromptForNextBest(
  request: OrchestrationTaskRequest,
  userId: string,
  effectiveKey: string,
): Promise<string | null> {
  const projectState = await getProjectState(userId, request.projectKey).catch(() => null);
  const healthBlocks =
    (projectState?.sessionHealth ?? "").toLowerCase().includes("critical") ||
    (projectState?.sessionTests ?? "").toLowerCase().includes("fail");
  if (healthBlocks) return null;

  const first = projectState?.promptQueue[0];
  if (!first) return null;
  const consumed = await consumeProjectPrompt(userId, request.projectKey, first).catch(() => null);
  if (!consumed?.consumed) return null;

  writePromptQueueMirror(effectiveKey, consumed.queue);
  request.intent = "custom";
  request.customInstructions = first;
  return first;
}

/** Create an orchestration_runs row for tab-injected adapters too — gives every dispatch
 *  an outcome to learn from, not just openclaw worker runs. */
async function createTabTrackedRun(
  request: OrchestrationTaskRequest,
  userId: string,
  effectiveKey: string,
): Promise<string | null> {
  try {
    const run = await createOrchestrationRun({
      userId,
      projectId: request.projectId ?? null,
      adapter: request.adapter,
      intent: request.intent,
      state: ORCH_STATE.RUNNING,
      projectKey: request.projectKey,
      projectPath: request.projectPath,
      payload: {
        projectId: request.projectId ?? null,
        projectKey: request.projectKey,
        projectPath: request.projectPath,
        model: request.model,
      },
    });
    // Sentinel read by scripts/agent-hook-bridge.sh:handle_stop to call the finish endpoint
    // with the captured outcome once the agent ends its session.
    fs.writeFileSync(stateFile.run(effectiveKey), run.id);
    return run.id;
  } catch (err) {
    console.error("[orchestration/run] tracked run create failed:", err);
    // Non-fatal — dispatch still proceeds without outcome tracking for this run.
    return null;
  }
}

/** Serialize same-project dispatch for tab-injected adapters (claude/codex/
 *  gemini/grok) — the ones that share the project's zellij tab + git checkout +
 *  /tmp sentinels. Queues this dispatch for the runner instead of colliding; it
 *  drains FIFO once our run is the oldest open one. */
async function dispatchQueuedBehind(
  request: OrchestrationTaskRequest,
  userId: string,
  opts: { intent: ResolvedIntent; trackedRunId: string | null; resolvedPromptBody: string },
): Promise<NextResponse> {
  const { intent, trackedRunId, resolvedPromptBody } = opts;
  // Route the queued row the same way the live branch routes: by the
  // project's stored locus and builder preference, never by who is online.
  const presence = await getBuilderPresence(userId).catch(() => ({
    cloud: false,
    local: false,
    any: false,
  }));
  const runnerConnected = presence.any;
  const busyMatch = await findRegistryProject(userId, request.projectKey);
  const pinnedChannel = pickDispatchChannel(busyMatch);

  // A parallel lane when one is free (see planParallelRun); otherwise the
  // queue does its old job and this run waits its turn.
  const plan = await planParallelRun(userId, trackedRunId, {
    projectKey: request.projectKey,
    prompt: resolvedPromptBody,
  });
  if (plan && trackedRunId) {
    return await dispatchParallelRun(request, userId, {
      intent,
      trackedRunId,
      plan,
      pinnedChannel,
      runnerConnected,
    });
  }

  const commandId = await enqueueDispatchCommand(userId, {
    tab: request.projectKey,
    channel: pinnedChannel,
    dir: request.projectPath,
    agent: request.adapter,
    prompt: resolvedPromptBody,
    promptKey: request.intent,
    promptLabel: intent.name,
    model: request.model,
    projectKey: request.projectKey,
    runId: trackedRunId ?? undefined,
  });
  return NextResponse.json({
    ok: true,
    queued: true,
    queuedBehind: true,
    mode: "queued",
    commandId,
    runId: trackedRunId,
    runnerConnected,
  });
}

/** Phase 2 of worktree-per-agent: same-project PARALLEL dispatch. With
 *  checkout isolation in place (each run gets its own git worktree), the
 *  only reason to queue was the shared tab/session/sentinel identity — so
 *  mint this run a derived tab alias (<project>~<runId8>) and every
 *  tab-keyed mechanism (PTY workspace, session handoff, sentinels, zellij
 *  tab, worktree) composes unchanged. The runner FORCES worktree isolation
 *  for derived tabs regardless of its env flag, so parallel-without-
 *  isolation is impossible. Run row keeps the BASE projectKey (analytics,
 *  busy checks aggregate per project); payload.sessionTab carries the alias
 *  for the close path. Opt-in via LOKI_PARALLEL_DISPATCH. */
async function dispatchParallelRun(
  request: OrchestrationTaskRequest,
  userId: string,
  opts: {
    intent: ResolvedIntent;
    trackedRunId: string;
    plan: ParallelRunPlan;
    pinnedChannel: ReturnType<typeof pickDispatchChannel>;
    runnerConnected: boolean;
  },
): Promise<NextResponse> {
  const { intent, trackedRunId, plan, pinnedChannel, runnerConnected } = opts;
  const runTab = plan.tab;
  const commandId = await enqueueDispatchCommand(userId, {
    tab: runTab,
    channel: pinnedChannel,
    dir: request.projectPath,
    agent: request.adapter,
    prompt: plan.prompt,
    promptKey: request.intent,
    promptLabel: intent.name,
    model: request.model,
    projectKey: request.projectKey,
    runId: trackedRunId,
  });
  return NextResponse.json({
    ok: true,
    queued: true,
    parallel: true,
    mode: "parallel",
    tab: runTab,
    commandId,
    runId: trackedRunId,
    runnerConnected,
  });
}

/** Write the lifecycle sentinels a dispatch leaves behind: hard_stop closes the
 *  session outright, close_session marks it closing, and any other intent clears
 *  a stale closing sentinel so the UI doesn't stay in "Closing…". */
function writeLifecycleSentinels(intentId: string, effectiveKey: string, nowS: number) {
  if (intentId === "hard_stop") {
    fs.writeFileSync(stateFile.sentinel(effectiveKey), "");
    fs.writeFileSync(stateFile.closing(effectiveKey), String(nowS));
    fs.writeFileSync(stateFile.closed(effectiveKey), String(nowS));
    return;
  }
  if (intentId === "close_session") {
    // Sentinel tells the stop hook to write closedAt (not readyAt) when the session ends.
    // Mirrors the same logic in /api/inject for close_session.
    fs.writeFileSync(stateFile.sentinel(effectiveKey), "");
    fs.writeFileSync(stateFile.closing(effectiveKey), String(nowS));
    return;
  }
  // Clear any stale closing sentinel so the UI doesn't stay in "Closing…" state
  // if the user re-dispatches after a close_session was sent but not yet completed.
  // Mirrors the same guard in the inject route and the codex/gemini adapter path.
  try {
    fs.unlinkSync(stateFile.closing(effectiveKey));
  } catch {
    /* already gone */
  }
}

function logInjectFailure(request: OrchestrationTaskRequest, userId: string, message: string) {
  logDebug({
    source: "api/orchestration/run",
    level: "error",
    message: `${request.adapter} inject failed: ${message}`,
    meta: {
      userId,
      adapter: request.adapter,
      intent: request.intent,
      projectKey: request.projectKey,
      projectPath: request.projectPath,
    },
  });
}

/** Claude remains hook-driven via prompt injection into a live tab. */
async function dispatchClaudeInject(
  request: OrchestrationTaskRequest,
  userId: string,
  opts: {
    intent: ResolvedIntent;
    effectiveKey: string;
    withOperator: (body: string) => string;
    restoreConsumedQueueItem: () => Promise<void>;
  },
): Promise<NextResponse> {
  const { intent, effectiveKey, withOperator, restoreConsumedQueueItem } = opts;
  try {
    const nowS = Math.floor(Date.now() / 1000);
    const prompt = withOperator(renderTaskForAdapter(request));
    const stateDescription = await describeProjectState(userId, request.projectKey);
    // hard_stop skips session context — inject the bare stop directive, then immediately
    // block auto-continue so stop.sh won't re-open even after Claude goes idle.
    const fullPrompt =
      request.intent === "hard_stop"
        ? prompt
        : buildPromptWithSession(prompt, request.projectKey, stateDescription);
    injectOwned(userId, effectiveKey, fullPrompt);
    clearHandshakeFiles(effectiveKey);
    if (request.intent !== "hard_stop" && request.intent !== "close_session") {
      // Write current-prompt so the UI shows the running banner.
      // Mirrors the codex/gemini adapter paths and the inject route.
      // Excluded for lifecycle intents (hard_stop/close_session) which end sessions.
      fs.writeFileSync(
        stateFile.prompt(effectiveKey),
        JSON.stringify({
          key: request.intent,
          label: intent.name,
          startedAt: nowS,
          source: "run",
          adapter: "claude",
        }),
      );
    }
    writeLifecycleSentinels(request.intent, effectiveKey, nowS);
    return NextResponse.json({
      ok: true,
      injected: true,
      adapter: request.adapter,
      intent: request.intent,
    });
  } catch (err) {
    await restoreConsumedQueueItem();
    const message = err instanceof Error ? err.message : String(err);
    logInjectFailure(request, userId, message);
    return NextResponse.json({ error: `Inject failed: ${message}` }, { status: 500 });
  }
}

/** Codex and Gemini have no native stop hook in this environment, so run the task as a
 *  one-shot command in the project tab and hand completion back to the same
 *  stop-hook bridge Beacon already uses for Claude. */
async function dispatchCodexOrGemini(
  request: OrchestrationTaskRequest,
  userId: string,
  opts: {
    intent: ResolvedIntent;
    effectiveKey: string;
    restoreConsumedQueueItem: () => Promise<void>;
  },
): Promise<NextResponse> {
  const { intent, effectiveKey, restoreConsumedQueueItem } = opts;
  try {
    const basePrompt = renderTaskForAdapter(request);
    const prompt = buildPromptWithSession(
      basePrompt,
      effectiveKey,
      await describeProjectState(userId, request.projectKey),
    );
    const promptFile = path.join(
      "/tmp",
      `${APP_SLUG}-${request.adapter}-prompt-${randomUUID()}.txt`,
    );
    fs.writeFileSync(promptFile, prompt);

    const nowS = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      stateFile.prompt(effectiveKey),
      JSON.stringify({
        key: request.intent,
        label: intent.name,
        startedAt: nowS,
        source: "runner",
        adapter: request.adapter,
      }),
    );

    emitTaskEvent(request, userId, {
      eventType:
        request.intent === "close_session" || request.intent === "hard_stop"
          ? "close_requested"
          : "continue_requested",
      detail: intent.name,
      happenedAt: new Date(nowS * 1000),
    });
    emitTaskEvent(request, userId, {
      eventType: "task_started",
      detail: intent.name,
      happenedAt: new Date(nowS * 1000),
    });

    clearHandshakeFiles(effectiveKey);
    writeLifecycleSentinels(request.intent, effectiveKey, nowS);

    await provisionTaskRunner(request, userId, { effectiveKey, promptFile });
    persistProjectRuntimeIfNewer({
      projectKey: request.projectKey,
      projectId: request.projectId ?? null,
      userId,
      workspaceId: workspaceIdFor(userId, request.projectKey),
      tabName: effectiveKey,
      runtimeObservedAt: new Date(),
      currentPromptKey: request.intent,
      currentPromptLabel: intent.name,
      currentPromptStartedAt: new Date(nowS * 1000),
    }).catch((err) => console.error("[orchestration/run] db write failed:", err));
    return NextResponse.json({
      ok: true,
      injected: true,
      adapter: request.adapter,
      intent: request.intent,
    });
  } catch (err) {
    await restoreConsumedQueueItem();
    try {
      fs.unlinkSync(stateFile.prompt(effectiveKey));
    } catch {
      /* absent */
    }
    const message = err instanceof Error ? err.message : String(err);
    logInjectFailure(request, userId, message);
    // Close the started/failed pair — task_started was emitted above before the
    // task runner was provisioned; if that throws, record the failed counterpart
    // here so orchestration_events doesn't carry an orphan start.
    emitTaskEvent(request, userId, {
      eventType: "task_failed",
      detail: `${intent.name}: ${message}`.slice(0, 400),
      happenedAt: new Date(),
      failureLabel: "task_failed",
    });
    return NextResponse.json({ error: `Inject failed: ${message}` }, { status: 500 });
  }
}

/** The task script runs as its own owned process — an argument vector, no
 *  shell line typed into a terminal — so the terminal page can watch it
 *  and it cannot land in the wrong tab. */
async function provisionTaskRunner(
  request: OrchestrationTaskRequest,
  userId: string,
  opts: { effectiveKey: string; promptFile: string },
) {
  const runner = path.join(
    process.cwd(),
    "scripts",
    request.adapter === "gemini" ? "run-gemini-task.sh" : "run-codex-task.sh",
  );
  const taskModel =
    request.model?.trim() ||
    (request.adapter === "gemini" ? AGENT_DEFAULT_MODELS.gemini : AGENT_DEFAULT_MODELS.codex);
  const { executor } = await import("@/lib/agent-execution");
  await executor.provision({
    id: `${workspaceIdFor(userId, opts.effectiveKey)}:task:${Date.now()}`,
    cwd: request.projectPath,
    command: "bash",
    args: [runner, opts.effectiveKey, request.projectPath, opts.promptFile, taskModel],
  });
}

/** Fire-and-forget orchestration_events write, with the same failure log line
 *  every emit site in this route used. */
function emitTaskEvent(
  request: OrchestrationTaskRequest,
  userId: string,
  opts: {
    eventType: OrchestrationEventType;
    detail: string;
    happenedAt: Date;
    failureLabel?: string;
  },
) {
  createOrchestrationEvent({
    userId,
    projectId: request.projectId ?? null,
    projectKey: request.projectKey,
    eventType: opts.eventType,
    source: "api-orchestration",
    adapter: request.adapter,
    intent: request.intent,
    detail: opts.detail,
    happenedAt: opts.happenedAt,
  }).catch((e) =>
    console.error(`[orchestration/run] ${opts.failureLabel ?? "db"} write failed:`, e),
  );
}

async function dispatchOpenClawRun(
  request: OrchestrationTaskRequest,
  userId: string,
  intent: ResolvedIntent,
): Promise<NextResponse> {
  const run = await createOrchestrationRun({
    userId,
    projectId: request.projectId ?? null,
    adapter: request.adapter,
    intent: request.intent,
    state: ORCH_STATE.RUNNING,
    projectKey: request.projectKey,
    projectPath: request.projectPath,
    payload: {
      projectId: request.projectId ?? null,
      projectKey: request.projectKey,
      projectPath: request.projectPath,
      model: request.model,
    },
  });

  // Emit task_started for openclaw too — until now this branch had no
  // lifecycle event of any kind on success (the codex/gemini branch
  // emits task_started but this branch skipped it), so every
  // successful openclaw run was invisible in orchestration_events. The
  // matching task_completed/task_failed is emitted by the worker script.
  emitTaskEvent(request, userId, {
    eventType: "task_started",
    detail: intent.name,
    happenedAt: new Date(),
    failureLabel: "task_started",
  });

  try {
    await scheduleOpenClawWorker(run.id, userId, request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateOrchestrationRun(run.id, {
      state: ORCH_STATE.ERROR,
      outcome: "error",
      finishedAt: new Date(),
      payload: {
        projectId: request.projectId ?? null,
        projectKey: request.projectKey,
        projectPath: request.projectPath,
        error: `Failed to start worker: ${message}`,
      },
    });
    logDebug({
      source: "api/orchestration/run",
      level: "error",
      message: `openclaw worker start failed: ${message}`,
      meta: {
        userId,
        runId: run.id,
        adapter: request.adapter,
        intent: request.intent,
        projectKey: request.projectKey,
        projectPath: request.projectPath,
      },
    });
    // Worker never started → the orchestration_runs row was just marked
    // outcome:'error' above, but orchestration_events still had nothing
    // for the openclaw failure path. Emit task_failed so the dispatch-
    // outcome timeline shows the attempt regardless of which adapter
    // failed.
    // Canonical shape: "<intent_or_label>: <error>" — matches the other
    // task_failed emit sites so downstream queries don't need to parse
    // multiple separator formats. Source field 'api-orchestration' already
    // carries the "openclaw worker start failed" context.
    emitTaskEvent(request, userId, {
      eventType: "task_failed",
      detail: `${intent.name}: ${message}`.slice(0, 400),
      happenedAt: new Date(),
      failureLabel: "task_failed",
    });
    return NextResponse.json({ error: "Worker failed to start" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    queued: true,
    run: {
      id: run.id,
      state: run.state,
      startedAt: run.startedAt,
    },
    adapter: getAdapterDefinition(request.adapter as AdapterId),
    intent,
  });
}

export async function POST(req: NextRequest) {
  const dataOrResp = await readJsonBody(req, RunOrchestrationBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const actor = await getApiActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = actor.userId;

  // A person clicked an intent button and may close the tab immediately; a
  // Bearer token is autopilot, whose churn must stay silent. A real signal,
  // rather than a hand-kept list of "automated" call sites that a new one
  // silently joins.
  const announceOnClose = shouldAnnounceOnClose(actor);

  const unresolved = await resolveProjectDefaults(dataOrResp, userId);
  if (unresolved) return unresolved;

  // status:working gate removed 2026-06-11 (Session 5b of killing-the-bash-
  // runner). Original 2026-05-31 rationale: "even with status:working set,
  // the runner kept getting fresh inject commands" — but the bash runner
  // that motivated this defence-in-depth is gone (Sessions 1-4). The only
  // entry path that still routes through here is manual user clicks on
  // /control intent buttons; gating those was a false positive. A human
  // explicitly clicking Send IS the override signal. The autopilot path
  // (dispatch → dispatch-gates.ts) still respects status:working for
  // auto-fire; manual fires fly through unconditionally.

  if (!isRuntimeAvailable()) {
    return await dispatchViaCloudQueue(
      dataOrResp as OrchestrationTaskRequest,
      userId,
      announceOnClose,
    );
  }
  const request: OrchestrationTaskRequest = dataOrResp as OrchestrationTaskRequest;
  const adapter = getAdapterDefinition(request.adapter as AdapterId);
  let intent = getOrchestrationIntent(request.intent as OrchestrationTaskIntentId);

  // Resolve the live tab once — the owned PTY's key may differ in case.
  const activeTabs = listOwnedTabs(userId, [request.projectKey]);
  const effectiveKey =
    activeTabs.length > 0
      ? resolveEffectiveTab(request.projectKey, activeTabs)
      : request.projectKey;

  let consumedQueueItem: string | null = null;
  if (adapter.capabilities.tabInjected && request.intent === "next_best") {
    consumedQueueItem = await popQueuedPromptForNextBest(request, userId, effectiveKey);
    if (consumedQueueItem) intent = getOrchestrationIntent("custom");
  }

  const restoreConsumedQueueItem = async () => {
    if (!consumedQueueItem) return;
    const restored = await prependProjectPrompt(
      userId,
      request.projectKey,
      effectiveKey,
      consumedQueueItem,
    ).catch(() => null);
    if (restored?.applied) writePromptQueueMirror(effectiveKey, restored.queue);
  };

  // Screenshots become text here, before context assembly and before prompt
  // history is written — so the agent, the ledger and the Activity view all
  // see the same instruction. Applies only to a custom dispatch: a templated
  // intent has no free-text field for a description to belong to.
  // Read from the PARSED BODY, not from `request`: request is cast to
  // OrchestrationTaskRequest, the adapter-facing shape, which deliberately has
  // no attachments field — attachments never reach an adapter, only the text
  // they were turned into does.
  if (request.intent === "custom" && request.customInstructions) {
    request.customInstructions = await foldAttachmentsIntoPrompt(
      request.customInstructions,
      dataOrResp.attachments,
    );
  }

  // Aim the agent at the project's roadmap: brief + active goals (getProjectContext).
  request.projectContext = (await getProjectContext(userId, request.projectKey)) ?? undefined;
  // Life-OS half: the operator's top-level goals + near-term deadlines, prepended
  // as a background section so tab-injected and queued-behind dispatches serve the
  // captain's objectives too (mirrors inject-core/inject-prompt). Best-effort.
  const operatorSection = await buildOperatorContextSection(userId).catch(() => "");
  const withOperator = (body: string) => [operatorSection, body].filter(Boolean).join("\n\n");
  // Log every dispatch regardless of adapter — foundation for reuse suggestions and analytics
  const resolvedPromptBody = withOperator(renderTaskForAdapter(request));
  // (Written AFTER the run row below, so the prompt can carry the run's id.
  // This used to be a fire-and-forget insert placed here, BEFORE the run was
  // created — which left prompt_history joinable to its outcome only by
  // time-proximity heuristics, the exact gap self-improvement-plan.md names.)

  // Lifecycle intents (hard_stop / close_session) end sessions and don't produce
  // work outcomes, so they're skipped.
  const TRACKABLE_INTENTS = request.intent !== "hard_stop" && request.intent !== "close_session";
  const TAB_ADAPTERS = adapter.capabilities.tabInjected;
  const trackedRunId =
    TAB_ADAPTERS && TRACKABLE_INTENTS
      ? await createTabTrackedRun(request, userId, effectiveKey)
      : null;

  // The ordered, linked pair: the run exists (or provably could not be
  // created), so the prompt records which run it became. Still fire-and-forget
  // — a ledger hiccup must not block a dispatch — but the ORDER is now a
  // guarantee, not an accident of layout.
  insertPromptHistory(userId, {
    projectId: request.projectId ?? null,
    projectKey: request.projectKey,
    projectPath: request.projectPath,
    adapter: request.adapter as AdapterId,
    intent: request.intent as OrchestrationTaskIntentId,
    customPrompt: request.intent === "custom" ? (request.customInstructions ?? null) : null,
    resolvedPrompt: resolvedPromptBody,
    runId: trackedRunId,
  }).catch((err) => console.error("[orchestration/run] db write failed:", err));

  // If another agent's run is already ahead of ours for this project, queue this
  // dispatch for the runner instead of colliding. TRACKABLE_INTENTS already
  // excludes hard_stop/close_session (which must always fire to interrupt).
  // openclaw is a detached worker (no shared tab/checkout) → not gated. Fail
  // open on DB hiccup.
  if (
    TAB_ADAPTERS &&
    TRACKABLE_INTENTS &&
    (await isProjectBusy(userId, request.projectKey, {
      excludeRunId: trackedRunId ?? undefined,
    }).catch(() => false))
  ) {
    return await dispatchQueuedBehind(request, userId, {
      intent,
      trackedRunId,
      resolvedPromptBody,
    });
  }

  if (request.adapter === "claude") {
    return await dispatchClaudeInject(request, userId, {
      intent,
      effectiveKey,
      withOperator,
      restoreConsumedQueueItem,
    });
  }

  if (request.adapter === "codex" || request.adapter === "gemini") {
    return await dispatchCodexOrGemini(request, userId, {
      intent,
      effectiveKey,
      restoreConsumedQueueItem,
    });
  }

  if (request.adapter !== "openclaw") {
    return NextResponse.json(
      {
        error: `${adapter.label} runner is not implemented yet`,
        adapter,
        intent,
      },
      { status: 501 },
    );
  }

  return await dispatchOpenClawRun(request, userId, intent);
}
