/**
 * Inject core — SSOT for dispatching a prompt into a project's agent session.
 *
 * Extracted verbatim from the /api/inject route so server-side callers (the
 * Loki messages route) can dispatch WITHOUT a self-HTTP round-trip. Behavior is
 * identical to the route: it returns `{ status, body }` where the route used to
 * return `NextResponse.json(body, { status })`. The route stays the thin
 * boundary (body parse + auth + the 401 log); everything after auth lives here.
 *
 * This path is autopilot-critical — keep it behavior-preserving.
 */
import { ensureUserProjectEntityLinks, getOrgProjects } from "@/db/queries/user-projects";
import type { UserProject } from "@/db/schema";
import {
  ORCHESTRATION_ADAPTER_IDS,
  ORCHESTRATION_TASK_INTENT_IDS,
  DEFAULT_ADAPTER_ID,
  renderProjectContextBlock,
  type OrchestrationTaskIntentId,
  type AdapterId,
} from "@/lib/orchestration";
import { getProjectContext } from "@/db/queries/project-context";
import { isRuntimeAvailable } from "@/lib/runtime";
import { ORCH_STATE } from "@/lib/orchestration/contract";
import { workspaceIdFor } from "@/lib/agent-execution/ownership";
import { executeInject } from "@/lib/executor";
import {
  coldStartWorkspaceDir,
  pickDispatchChannel,
  projectChannelLock,
} from "@/lib/execution-access";
import type { RunnerChannel } from "@/db/schema/pending-commands";
import {
  createOrchestrationEvent,
  createOrchestrationEventOnce,
} from "@/db/queries/orchestration-events";
import {
  createOrchestrationRun,
  closeRunUndelivered,
  isProjectBusy,
  stampRunDelivered,
  stampRunCommandId,
} from "@/db/queries/orchestration-runs";
import { emitRunEvent } from "@/db/queries/run-events";
import { insertPromptHistory } from "@/db/queries/prompt-history";
import { getProjectState, persistProjectRuntimeIfNewer } from "@/db/queries/project-states";
import { deriveProjectStateKey, projectStateDescription } from "@/lib/control-states";
import { logDebug } from "@/db/queries/debug-logs";
import { promptFingerprint, recordControlAuditEvent } from "@/db/queries/control-audit-events";
import { enqueueHostedDispatchCommand } from "@/db/queries/pending-commands";
import { isHostedBuilderPref } from "@/lib/constants/statuses";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { retrieveFleetContextBlock } from "@/db/queries/knowledge-embeddings";
import { assembleInjectPrompt } from "@/lib/inject-prompt";
import { buildOperatorContextSection } from "@/lib/dispatch-operator-context";
import { getOpenEscalationBlock } from "@/db/queries/run-escalations";
import { findInjectProject } from "@/lib/inject-project";

type ResolvedAdapter = (typeof ORCHESTRATION_ADAPTER_IDS)[number];

export type InjectParams = {
  tab: string;
  /** Stable entity project id; when supplied names are transport labels only. */
  projectId?: string;
  /** Disable an alternate hosted executor for actions tied to a tracked run. */
  allowHostedFallback?: boolean;
  promptKey?: string;
  customPrompt?: string;
  adapter?: ResolvedAdapter;
  /** Per-dispatch model override (e.g. Loki's composer model picker). Wins over
   *  the project's stored modelPref; the runner reads it on auto-launch. */
  model?: string;
  runId?: string;
  /** Push the close outcome to chat (Telegram). Set by chat-originated
   *  dispatches (Loki's fleet skill) — see lib/orchestration/notify-close.ts. */
  notifyOnClose?: boolean;
  /** The Loki conversation this dispatch came from; the close outcome is
   *  posted back into it. */
  conversationId?: string;
  /** Claude's native session identity. Tabs remain transport only. */
  sessionId?: string;
  /**
   * Prefer this builder when the project is not locus-locked. Phone Implement
   * passes "cloud" so work lands on the always-on box-runner instead of a
   * laptop whose lid is closed (builder_pref: local).
   */
  builderChannel?: RunnerChannel;
  /**
   * When true, a queued dispatch with no live builder and no hosted fallback
   * fails instead of sitting "Queued / Not running" forever. Boss-mode: attach
   * to a real worker or say what to do next — never queue into the void.
   */
  refuseOfflineQueue?: boolean;
};

export type InjectResult = { status: number; body: Record<string, unknown> };

type ResolvedTarget = {
  dbMatch: UserProject;
  canonical: string;
  projectPath: string | null;
  projectId: string | null;
};

type BuiltPrompt = { prompt: string; promptLabel: string };

function isInjectResult(value: object): value is InjectResult {
  return "status" in value && "body" in value;
}

/** Resolve canonical tab name and project path — own projects first, then org
 *  team projects. Returns the 404 result (with its warn log and audit row) when
 *  the caller named a project they cannot reach. */
async function resolveInjectTarget(
  params: InjectParams,
  userId: string,
): Promise<ResolvedTarget | InjectResult> {
  const { tab, promptKey, customPrompt } = params;
  const [dbProjects, dbTeamProjects] = await Promise.all([
    ensureUserProjectEntityLinks(userId).catch(() => []),
    getOrgProjects(userId).catch(() => []),
  ]);
  const dbMatch =
    findInjectProject(dbProjects, tab, params.projectId) ??
    findInjectProject(dbTeamProjects, tab, params.projectId);
  if (!dbMatch) {
    logDebug({
      source: "api/inject",
      level: "warn",
      message: `Project not found: ${params.projectId ?? tab}`,
      meta: { userId, tab, hasPromptKey: !!promptKey, hasCustomPrompt: !!customPrompt },
    });
    recordControlAuditEvent({
      userId,
      projectKey: tab,
      tabName: tab,
      event: "inject_request",
      source: "api/inject",
      action: "refused",
      reason: "Project not found",
      queueLength: null,
      blockerCount: null,
      promptHash: null,
      promptPreview: customPrompt?.slice(0, 220) ?? promptKey ?? null,
      meta: { hasPromptKey: !!promptKey, hasCustomPrompt: !!customPrompt },
    });
    return { status: 404, body: { error: `Project not found: ${params.projectId ?? tab}` } };
  }
  return {
    dbMatch,
    canonical: dbMatch.name,
    projectPath: dbMatch.dirPath ?? null,
    projectId: dbMatch.entityProjectId ?? null,
  };
}

/** Honor the project's per-row agent preference when the caller didn't pin one.
 *  Without this the runner defaults to "claude" for every project regardless
 *  of agent_pref, so a Gemini project gets a Claude launch and a Cursor
 *  project gets Claude too. The DB column is text, so validate it's still a
 *  supported adapter before trusting it. */
function resolveEventAdapter(
  adapter: ResolvedAdapter | undefined,
  dbMatch: UserProject,
): ResolvedAdapter {
  if (!adapter && dbMatch.agentPref) {
    const ids = ORCHESTRATION_ADAPTER_IDS as readonly string[];
    if (ids.includes(dbMatch.agentPref)) return dbMatch.agentPref as ResolvedAdapter;
  }
  return adapter ?? DEFAULT_ADAPTER_ID;
}

/** Local: build the prompt with session context. These imports read /tmp
 *  files — only safe locally. The tab is the canonical project name; the
 *  owned PTY is keyed by it, and there is no other terminal to resolve. */
async function buildLocalPrompt(args: {
  userId: string;
  canonical: string;
  effectiveTab: string;
  promptKey?: string;
  customPrompt?: string;
  eventAdapter: ResolvedAdapter;
}): Promise<BuiltPrompt | InjectResult> {
  const { userId, canonical, effectiveTab, promptKey, customPrompt, eventAdapter } = args;
  const { readPrompts, readPromptMeta } = await import("@/lib/agent-config");

  // Global + Project tiers (operating principles + brief + active goals) — the
  // SAME assembler the /api/orchestration/run path uses. Previously this local
  // inject path skipped it, so quick-send / promptKey dispatches reached the
  // agent without the founder's standards or the project's roadmap (the
  // "inject-core bypass"). buildPromptWithSession then adds the Session tier, so
  // every dispatch now carries all three tiers. Best-effort: never break a
  // dispatch if context assembly fails.
  const ragQuery = customPrompt ?? promptKey ?? "";
  // Captain RAG: relevant context from the operator's OTHER projects (fleet
  // vector index). Operator block: the life-OS half — top-level goals +
  // near-term deadlines, so local dispatches serve the captain's objectives
  // too, not just the per-project task. Both best-effort; both mirror the
  // cloud assembleInjectPrompt path so local and remote dispatch match.
  const [projectContext, fleetBlock, operatorSection, escalationBlock] = await Promise.all([
    getProjectContext(userId, canonical).catch(() => null),
    ragQuery
      ? retrieveFleetContextBlock(userId, ragQuery, { excludeProject: canonical }).catch(() => "")
      : Promise.resolve(""),
    buildOperatorContextSection(userId).catch(() => ""),
    // Open escalation ladder — the last failure fed back to the agent with a
    // rung-specific instruction. Mirrors assembleInjectPrompt.
    getOpenEscalationBlock(userId, canonical).catch(() => ""),
  ]);
  const contextBlock = renderProjectContextBlock(projectContext ?? undefined);
  const withContext = (body: string) =>
    [
      contextBlock || null,
      operatorSection || null,
      fleetBlock || null,
      escalationBlock || null,
      body,
    ]
      .filter(Boolean)
      .join("\n\n");

  if (customPrompt) {
    return { prompt: withContext(customPrompt), promptLabel: customPrompt.slice(0, 40) };
  }
  if (!promptKey) {
    return { status: 400, body: { error: "promptKey or customPrompt required" } };
  }
  const prompts = readPrompts();
  const base = prompts[promptKey];
  if (!base) return { status: 400, body: { error: `Unknown prompt key: ${promptKey}` } };
  // Project state context — same description shown on the badge
  // tooltip, prepended so the agent reasons from the same WHY.
  const injectRow = await getProjectState(userId, effectiveTab).catch(() => null);
  const stateKey = deriveProjectStateKey({
    agentRunning: injectRow?.agentRunning,
    tabOpen: injectRow?.tabOpen,
    sessionStatus: injectRow?.sessionStatus,
    readyAt: injectRow?.readyAt ? Math.floor(injectRow.readyAt.getTime() / 1000) : null,
    lockAt: injectRow?.lockAt ? Math.floor(injectRow.lockAt.getTime() / 1000) : null,
    closingAt: injectRow?.closingAt ? Math.floor(injectRow.closingAt.getTime() / 1000) : null,
    closedAt: injectRow?.closedAt ? Math.floor(injectRow.closedAt.getTime() / 1000) : null,
  });
  // Adapter owns prompt enrichment: the claude seam appends
  // ~/.loki/sessions/<tab>.md (identical to the prior buildPromptWithSession
  // call); adapters without a session seam fall back to identity.
  const enrichPrompt =
    (await import("@/lib/orchestration/adapter-registry")).adapterFor(eventAdapter)?.enrichPrompt ??
    ((b: string) => b);
  const meta = readPromptMeta().find((m) => m.key === promptKey);
  return {
    prompt: withContext(enrichPrompt(base, effectiveTab, projectStateDescription(stateKey))),
    promptLabel: meta ? `${meta.icon} ${meta.label}` : promptKey,
  };
}

/** Remote (cloud host): assemble the SAME prompt body as orchestration/run —
 *  profile + goals + intent template + fleet RAG — before queueing for the
 *  runner. Previously we queued bare promptKey strings ("next_best"), so
 *  phone/Loki/beacon dispatches reached agents without project context. */
async function buildRemotePrompt(args: {
  userId: string;
  canonical: string;
  projectPath: string | null;
  projectId: string | null;
  eventAdapter: ResolvedAdapter;
  promptKey?: string;
  customPrompt?: string;
  eventModel?: string;
}): Promise<BuiltPrompt | InjectResult> {
  const assembled = await assembleInjectPrompt({
    userId: args.userId,
    projectKey: args.canonical,
    projectPath: args.projectPath ?? args.canonical,
    projectId: args.projectId,
    adapter: args.eventAdapter,
    promptKey: args.promptKey,
    customPrompt: args.customPrompt,
    model: args.eventModel,
  });
  if (!assembled.ok) return { status: assembled.status, body: { error: assembled.error } };
  return { prompt: assembled.prompt, promptLabel: assembled.promptLabel };
}

/** Open a tracked run for every trackable dispatch, on BOTH the cloud and the
 *  local-runtime path. Previously the local path was excluded (it relied on
 *  home/worker.ts to open the run), but that worker was retired in the
 *  bash-daemon kill — leaving local dispatches with no run at all, so Activity
 *  showed "0 runs / 0 finished". The control poll closes it when the agent's
 *  session handoff reports ready (see closeRunFromSession). */
async function openTrackedRun(
  params: InjectParams,
  userId: string,
  ctx: {
    projectId: string | null;
    canonical: string;
    resolvedProjectPath: string;
    eventAdapter: ResolvedAdapter;
    eventIntent?: OrchestrationTaskIntentId;
    eventModel?: string;
    promptLabel: string;
  },
): Promise<string | undefined> {
  try {
    const run = await createOrchestrationRun({
      userId,
      projectId: ctx.projectId,
      adapter: ctx.eventAdapter,
      intent: ctx.eventIntent ?? "custom",
      state: ORCH_STATE.WAITING,
      projectKey: ctx.canonical,
      projectPath: ctx.resolvedProjectPath,
      payload: {
        projectId: ctx.projectId,
        projectKey: ctx.canonical,
        projectPath: ctx.resolvedProjectPath,
        model: ctx.eventModel,
        ...(params.notifyOnClose ? { notifyOnClose: true } : {}),
        ...(params.conversationId ? { conversationId: params.conversationId } : {}),
      },
    });
    // Run ledger: the first hop declares itself (Stage 1 of the
    // execution-substrate redesign — every hop is an event, silence is
    // visible by definition).
    void emitRunEvent(run.id, userId, "dispatched", {
      intent: ctx.eventIntent ?? "custom",
      projectKey: ctx.canonical,
      promptLabel: ctx.promptLabel,
    });
    return run.id;
  } catch (err) {
    console.error("[inject] tracked-run create failed:", err);
    return undefined;
  }
}

/** Run local filesystem side-effects — the server process can always write to /tmp
 *  regardless of whether an owned PTY is live for this tab. */
async function writeLocalInjectSideEffects(
  userId: string,
  ctx: {
    effectiveTab: string;
    promptKey?: string;
    promptLabel: string;
    eventAdapter: ResolvedAdapter;
    nowS: number;
  },
) {
  const { effectiveTab, promptKey, promptLabel, eventAdapter, nowS } = ctx;
  const [{ cancelActiveBeaconSessions }, { stateFile, clearHandshakeFiles }, fs] =
    await Promise.all([
      import("@/app/api/beacon/route"),
      import("@/lib/agent-config"),
      import("fs"),
    ]);

  await cancelActiveBeaconSessions(userId, effectiveTab);

  fs.writeFileSync(
    stateFile.prompt(effectiveTab),
    JSON.stringify({
      key: promptKey ?? "custom",
      label: promptLabel,
      startedAt: nowS,
      source: "inject",
      adapter: eventAdapter,
    }),
  );

  clearHandshakeFiles(effectiveTab);

  if (promptKey === "hard_stop") {
    fs.writeFileSync(stateFile.sentinel(effectiveTab), "");
    fs.writeFileSync(stateFile.closing(effectiveTab), String(nowS));
    fs.writeFileSync(stateFile.closed(effectiveTab), String(nowS));
  } else if (promptKey === "close_session") {
    fs.writeFileSync(stateFile.sentinel(effectiveTab), "");
    fs.writeFileSync(stateFile.closing(effectiveTab), String(nowS));
  } else {
    try {
      fs.unlinkSync(stateFile.closing(effectiveTab));
    } catch {
      /* gone */
    }
  }
}

/** A project pinned to the HOSTED builder never touches a runner PTY: the
 *  task goes straight to the hosted runner (Hermes, in its own clone, on the
 *  providers the box already holds keys for), which closes the tracked run
 *  with the PR as evidence. This is the unattended path that needs no Claude
 *  credential — see HOSTED_BUILDER_PREF. */
async function dispatchToHostedBuilder(
  userId: string,
  ctx: {
    canonical: string;
    effectiveTab: string;
    projectId: string | null;
    gitUrl: string;
    prompt: string;
    runId?: string;
    eventIntent?: OrchestrationTaskIntentId;
    nowS: number;
  },
): Promise<InjectResult> {
  const hostedId = await enqueueHostedDispatchCommand(userId, {
    projectKey: ctx.canonical,
    gitUrl: ctx.gitUrl,
    task: ctx.prompt,
    ...(ctx.runId ? { runId: ctx.runId } : {}),
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
  });
  void createOrchestrationEventOnce(
    {
      userId,
      projectId: ctx.projectId,
      projectKey: ctx.canonical,
      eventType: "continue_requested",
      source: "hosted-runner",
      adapter: "hermes" as AdapterId,
      intent: ctx.eventIntent,
      detail: "Routed to the hosted runner (Hermes) — project pinned to the hosted builder",
      happenedAt: new Date(ctx.nowS * 1000),
    },
    `hosted-dispatch:${hostedId}`,
  ).catch((err) => console.error("[inject] hosted event emit failed:", err));
  return {
    status: 200,
    body: {
      ok: true,
      tab: ctx.effectiveTab,
      mode: "queued",
      channel: null,
      commandId: hostedId,
      runnerConnected: true,
      hostedDispatchId: hostedId,
      hostedRunner: "hermes",
      ...(ctx.runId && { runId: ctx.runId }),
    },
  };
}

type ExecuteInjectResult = Awaited<ReturnType<typeof executeInject>>;

/** Everything a dispatch outcome needs to name itself in the ledger. */
type OutcomeContext = {
  effectiveTab: string;
  canonical: string;
  projectId: string | null;
  resolvedProjectPath: string;
  ptyWorkspaceId: string;
  eventAdapter: ResolvedAdapter;
  eventIntent?: OrchestrationTaskIntentId;
  eventModel?: string;
  promptKey?: string;
  promptLabel: string;
  customPrompt?: string;
  prompt: string;
  runId?: string;
  runtimeAvailable: boolean;
  nowS: number;
};

/** The host's logs are unreliable from our env, so we persist to the DB.
 *  Capture failures in debug_logs so post-incident forensics can answer
 *  "what actually broke" without depending on log retention. */
function recordInjectFailure(
  userId: string,
  result: Extract<ExecuteInjectResult, { ok: false }>,
  ctx: OutcomeContext,
): InjectResult {
  logDebug({
    source: "api/inject",
    level: "error",
    message: `Injection failed: ${result.error}`,
    meta: {
      userId,
      tab: ctx.effectiveTab,
      canonical: ctx.canonical,
      mode: result.mode,
      adapter: ctx.eventAdapter,
      promptKey: ctx.promptKey ?? null,
      promptLabel: ctx.promptLabel,
      customPromptLen: ctx.customPrompt?.length ?? 0,
      runtimeAvailable: ctx.runtimeAvailable,
    },
  });
  // Mirror the task_started emit on the failure branch so the
  // started/failed pair closes in orchestration_events — without this,
  // every failed inject left an orphan task_started with no paired
  // completion of any kind (task_completed OR task_failed).
  createOrchestrationEvent({
    userId,
    projectId: ctx.projectId,
    projectKey: ctx.canonical,
    eventType: "task_failed",
    source: "api-inject",
    adapter: ctx.eventAdapter,
    intent: ctx.eventIntent,
    detail: `${ctx.promptLabel}: ${result.error}`.slice(0, 400),
    happenedAt: new Date(ctx.nowS * 1000),
  }).catch((err) => console.error("[inject] db write failed:", err));
  const fingerprint = promptFingerprint(ctx.prompt);
  recordControlAuditEvent({
    userId,
    projectId: ctx.projectId,
    projectKey: ctx.canonical,
    tabName: ctx.effectiveTab,
    event: "inject_request",
    source: "api/inject",
    action: "failed",
    reason: result.error,
    promptHash: fingerprint.promptHash,
    promptPreview: fingerprint.promptPreview,
    meta: {
      mode: result.mode,
      adapter: ctx.eventAdapter,
      model: ctx.eventModel ?? null,
      promptKey: ctx.promptKey ?? "custom",
      runtimeAvailable: ctx.runtimeAvailable,
    },
  });
  const code = (result as { code?: string }).code;
  const policyStatus =
    code === "builder-required" ? 409 : code === "cloud-builder-private" ? 403 : 500;
  return {
    status: policyStatus,
    body: {
      error: `Injection failed: ${result.error}`,
      ...(code ? { code } : {}),
    },
  };
}

/** Everything a delivered dispatch leaves behind: prompt history, the direct-mode
 *  delivery stamp and runtime row, the lifecycle events, and the audit row. */
function recordInjectSuccess(
  userId: string,
  result: Extract<ExecuteInjectResult, { ok: true }>,
  ctx: OutcomeContext,
) {
  // Prompt history records the user's request in both modes. A queued remote
  // request is not active work until the runner actually injects it and pushes
  // fresh runtime state back to the control plane.
  insertPromptHistory(userId, {
    projectId: ctx.projectId,
    projectKey: ctx.canonical,
    projectPath: ctx.resolvedProjectPath,
    adapter: ctx.eventAdapter,
    intent: ctx.eventIntent ?? "custom",
    customPrompt: ctx.customPrompt ?? null,
    // Link the prompt to the run it became — the run was opened above, so the
    // id exists by the time the prompt is recorded. Null only when run
    // creation failed or the intent is untrackable; the prompt row survives
    // either way (the ledger must not lose a dispatch to a failed join).
    runId: ctx.runId,
    // `prompt` is the fully assembled body — custom text or rendered intent
    // template — that was injected into the agent's tab. Persisting it makes
    // "Next best" rows showable as the actual prompt in the activity view.
    resolvedPrompt: ctx.prompt,
  }).catch((err) => console.error("[inject] db write failed:", err));

  if (result.mode === "direct") {
    // Direct mode injected straight into the live PTY, so the prompt HAS
    // reached the agent — there is no runner ack to stamp it later. Without
    // this, `deliveredAt` would mean "queued and ack'd" rather than simply
    // "delivered", and the close path could not read its absence as proof of
    // non-delivery. Same field, one meaning, both transports.
    if (ctx.runId) void stampRunDelivered(ctx.runId, userId);
    persistProjectRuntimeIfNewer({
      projectKey: ctx.canonical,
      projectId: ctx.projectId,
      userId,
      workspaceId: ctx.ptyWorkspaceId,
      tabName: ctx.effectiveTab,
      runtimeObservedAt: new Date(),
      currentPromptKey: ctx.promptKey ?? "custom",
      currentPromptLabel: ctx.promptLabel,
      currentPromptStartedAt: new Date(ctx.nowS * 1000),
    }).catch((err) => console.error("[inject] db write failed:", err));
  }

  createOrchestrationEvent({
    userId,
    projectId: ctx.projectId,
    projectKey: ctx.canonical,
    eventType:
      ctx.promptKey === "close_session" || ctx.promptKey === "hard_stop"
        ? "close_requested"
        : "continue_requested",
    source: "api-inject",
    adapter: ctx.eventAdapter,
    intent: ctx.eventIntent,
    detail: ctx.promptLabel,
    happenedAt: new Date(ctx.nowS * 1000),
  }).catch((err) => console.error("[inject] db write failed:", err));

  if (result.mode === "direct") {
    createOrchestrationEvent({
      userId,
      projectId: ctx.projectId,
      projectKey: ctx.canonical,
      eventType: "task_started",
      source: "api-inject",
      adapter: ctx.eventAdapter,
      intent: ctx.eventIntent,
      detail: ctx.promptLabel,
      happenedAt: new Date(ctx.nowS * 1000),
    }).catch((err) => console.error("[inject] db write failed:", err));
  }

  const fingerprint = promptFingerprint(ctx.prompt);
  recordControlAuditEvent({
    userId,
    projectId: ctx.projectId,
    projectKey: ctx.canonical,
    tabName: ctx.effectiveTab,
    event: "inject_request",
    source: "api/inject",
    action: result.mode === "queued" ? "queued" : "injected",
    reason:
      result.mode === "queued"
        ? (result as { runnerConnected?: boolean }).runnerConnected === false
          ? EXECUTOR_COPY.inject.queuedOfflineApi
          : // Either builder (cloud box-runner or desktop) can claim the queued
            // command — "local runner" was a lie whenever the box served it.
            "Queued — a connected builder (cloud or this computer) will claim it"
        : "Injected into local runtime",
    promptHash: fingerprint.promptHash,
    promptPreview: fingerprint.promptPreview,
    commandId: result.mode === "queued" ? (result as { commandId: string }).commandId : null,
    meta: {
      adapter: ctx.eventAdapter,
      model: ctx.eventModel ?? null,
      promptKey: ctx.promptKey ?? "custom",
      promptLabel: ctx.promptLabel,
      runtimeAvailable: ctx.runtimeAvailable,
    },
  });
}

/** Producer for the hosted runner: when the local Fleet Runner is offline, a
 *  WORK dispatch doesn't have to wait forever — auto-route it to the hosted
 *  runner (Hermes), which clones the repo, makes the change, and opens a PR.
 *  Only for real coding tasks with a git URL — never for lifecycle commands
 *  (close/stop) or projects we can't clone. Hermes uses its own configured
 *  Nous model, so we deliberately don't pass the local agent's model pref. */
async function routeToHostedFallback(
  userId: string,
  ctx: {
    canonical: string;
    gitUrl: string;
    prompt: string;
    projectId: string | null;
    eventIntent?: OrchestrationTaskIntentId;
  },
): Promise<string | undefined> {
  const hostedDispatchId = await enqueueHostedDispatchCommand(userId, {
    projectKey: ctx.canonical,
    gitUrl: ctx.gitUrl,
    task: ctx.prompt,
  }).catch((err) => {
    console.error("[inject] hosted-dispatch enqueue failed:", err);
    return undefined;
  });
  // Make the offline→hosted routing decision visible in Activity, not just a
  // response flag — same orchestration_events stream, attributed to the real
  // executor (Hermes). Deduped by command id so a retry can't double-count.
  if (hostedDispatchId) {
    void createOrchestrationEventOnce(
      {
        userId,
        projectId: ctx.projectId,
        projectKey: ctx.canonical,
        eventType: "continue_requested",
        source: "hosted-runner",
        adapter: "hermes" as AdapterId,
        intent: ctx.eventIntent,
        detail: "Auto-routed to hosted runner (Hermes) — local runner offline",
        happenedAt: new Date(),
      },
      `hosted-dispatch:${hostedDispatchId}`,
    ).catch((err) => console.error("[inject] hosted event emit failed:", err));
  }
  return hostedDispatchId;
}

type PreparedDispatch = {
  dbMatch: UserProject;
  outcome: OutcomeContext;
  injectFn: (() => Promise<void>) | null;
  ptyBacked: boolean;
  projectBusy: boolean;
  pinnedChannel: ReturnType<typeof pickDispatchChannel>;
  isLifecycle: boolean;
  projectPath: string | null;
  runtimeAvailable: boolean;
};

/** Hand the prepared dispatch to the executor, then record what came back:
 *  the failure ledger, or prompt history + lifecycle events + audit, the
 *  offline hosted fallback, and the response body the route returns. */
async function executeAndReport(
  params: InjectParams,
  userId: string,
  prepared: PreparedDispatch,
): Promise<InjectResult> {
  const {
    dbMatch,
    outcome,
    injectFn,
    ptyBacked,
    projectBusy,
    pinnedChannel,
    isLifecycle,
    projectPath,
    runtimeAvailable,
  } = prepared;
  const {
    effectiveTab,
    canonical,
    projectId,
    eventAdapter,
    eventModel,
    promptKey,
    promptLabel,
    prompt,
    runId,
  } = outcome;

  const result = await executeInject(
    {
      tab: effectiveTab,
      queueOnly: runtimeAvailable && !ptyBacked,
      prompt,
      promptKey,
      promptLabel,
      adapter: eventAdapter,
      model: eventModel,
      projectId,
      projectKey: canonical,
      runId,
      sessionId: params.sessionId,
      // A known checkout wins. Without one, hand the queue the directory the
      // runner will clone into — executeInject chooses DISPATCH (cold start)
      // over INJECT (tab puppeting) by whether `dir` is present.
      dir: projectPath ?? coldStartWorkspaceDir(canonical, dbMatch.gitUrl),
      projectBusy,
      channel: pinnedChannel,
    },
    userId,
    injectFn ?? (() => Promise.reject(new Error("Runtime unavailable"))),
  );

  if (!result.ok) return recordInjectFailure(userId, result, outcome);

  recordInjectSuccess(userId, result, outcome);

  const queuedOffline =
    result.mode === "queued" && (result as { runnerConnected?: boolean }).runnerConnected === false;

  if (runId && result.mode === "queued") {
    const cid = (result as { commandId?: string }).commandId;
    if (cid) void stampRunCommandId(runId, userId, cid);
  }

  let hostedDispatchId: string | undefined;
  if (params.allowHostedFallback !== false && queuedOffline && !isLifecycle && dbMatch.gitUrl) {
    hostedDispatchId = await routeToHostedFallback(userId, {
      canonical,
      gitUrl: dbMatch.gitUrl,
      prompt,
      projectId,
      eventIntent: outcome.eventIntent,
    });
  }

  // Boss-mode: never accept "Queued" when no builder will pick it up. Close the
  // tracked run so feedback does not sit Working/Not running with no PTY, and
  // return one next action the operator can take from Telegram/phone.
  if (params.refuseOfflineQueue && queuedOffline && !hostedDispatchId) {
    if (runId) {
      await closeRunUndelivered(
        runId,
        userId,
        "No builder online (cloud box-runner / Fleet Runner) to claim the command",
      ).catch((err) => console.error("[inject] close undelivered failed:", err));
    }
    return {
      status: 503,
      body: {
        ok: false,
        error: "No builder is online to run this.",
        nextAction:
          "Cloud builder is offline. Ensure loki-box-runner is active on the box, or open Fleet Runner — then tap Implement again.",
        code: "builder-offline",
        warning: "runner-offline",
        channel: pinnedChannel,
        ...(runId ? { runId } : {}),
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      tab: effectiveTab,
      mode: result.mode,
      // Which builder this went to. The operator should never have to guess
      // which machine has their work — especially when it queues.
      channel: pinnedChannel,
      ...(result.mode === "queued" && {
        commandId: (result as { commandId: string }).commandId,
        runnerConnected: (result as { runnerConnected?: boolean }).runnerConnected ?? null,
      }),
      // Fail loud, not silent: a dispatch that queued with no live runner says so,
      // so the UI can warn instead of pretending it's running.
      ...(queuedOffline && {
        warning: "runner-offline",
        message: hostedDispatchId
          ? EXECUTOR_COPY.inject.hostedAndLocal
          : EXECUTOR_COPY.inject.queuedOnly,
        ...(hostedDispatchId && { hostedDispatchId, hostedRunner: "hermes" }),
      }),
      ...(runId && { runId }),
    },
  };
}

/**
 * Resolve the target project, build the prompt, and dispatch it (direct local
 * inject or queued for the Fleet Runner). Returns the same payload/status the
 * /api/inject route returns. `userId` is already authenticated by the caller.
 */
export async function injectPrompt(params: InjectParams, userId: string): Promise<InjectResult> {
  const { promptKey, customPrompt, adapter } = params;
  const runtimeAvailable = isRuntimeAvailable();
  let runId = params.runId;

  const target = await resolveInjectTarget(params, userId);
  if (isInjectResult(target)) return target;
  const { dbMatch, canonical, projectPath, projectId } = target;

  // Is this project backed by a live Loki-owned PTY (server-side launch)?
  // The executor registry is the SSOT — a live handle means we drive the agent's
  // stdin directly. No live workspace → there is no agent to type at, so the
  // prompt is queued as a dispatch below (cloud mode never has one; injectFn is
  // null there).
  const ptyWorkspaceId = workspaceIdFor(userId, canonical);
  const ptyExecutor = runtimeAvailable ? (await import("@/lib/agent-execution")).executor : null;
  const ptyHandle = ptyExecutor ? ptyExecutor.get(ptyWorkspaceId) : null;
  const ptyBacked = !!ptyHandle && ptyHandle.status !== "exited";

  const eventAdapter = resolveEventAdapter(adapter, dbMatch);

  // Model override: a caller-supplied model (Loki's composer model picker) wins
  // over the project's stored modelPref. The runner's execute_inject auto-launch
  // reads payload.model and prefers it over the conf-file model, so a project
  // pinned to "opus" launches Claude with opus and a one-off dispatch pinned to
  // "gpt-5" gets gpt-5 instead of the runner's hardcoded gpt-5.4 default.
  const eventModel = params.model?.trim() || dbMatch.modelPref?.trim() || undefined;

  const effectiveTab = canonical;
  const built = runtimeAvailable
    ? await buildLocalPrompt({
        userId,
        canonical,
        effectiveTab,
        promptKey,
        customPrompt,
        eventAdapter,
      })
    : await buildRemotePrompt({
        userId,
        canonical,
        projectPath,
        projectId,
        eventAdapter,
        promptKey,
        customPrompt,
        eventModel,
      });
  if (isInjectResult(built)) return built;
  const { prompt, promptLabel } = built;

  const eventIntent: OrchestrationTaskIntentId | undefined =
    promptKey && ORCHESTRATION_TASK_INTENT_IDS.includes(promptKey as OrchestrationTaskIntentId)
      ? (promptKey as OrchestrationTaskIntentId)
      : customPrompt
        ? "custom"
        : undefined;

  const resolvedProjectPath = projectPath ?? canonical;
  const nowS = Math.floor(Date.now() / 1000);

  // Build the local injection function. PTY-backed agents are driven directly via
  // the executor (write to the owned PTY's stdin). Null in cloud mode →
  // executeInject queues for the runner.
  // Local + live owned PTY: write straight into it. Local + no PTY: there is
  // no agent to type at, so the prompt is QUEUED as a dispatch (cold start)
  // for the runner — visible in Control, never a keystroke into a guessed tab.
  const injectFn =
    runtimeAvailable && ptyBacked
      ? async () => {
          ptyExecutor?.write(ptyWorkspaceId, prompt.endsWith("\r") ? prompt : `${prompt}\r`);
        }
      : null;

  const trackableIntent = eventIntent !== "hard_stop" && eventIntent !== "close_session";
  if (!runId && trackableIntent) {
    runId = await openTrackedRun(params, userId, {
      projectId,
      canonical,
      resolvedProjectPath,
      eventAdapter,
      eventIntent,
      eventModel,
      promptLabel,
    });
  }

  if (runtimeAvailable) {
    await writeLocalInjectSideEffects(userId, {
      effectiveTab,
      promptKey,
      promptLabel,
      eventAdapter,
      nowS,
    });
  }

  // Serialize same-project dispatch: if another agent's run is already ahead of
  // ours for this project, executeInject queues this one for the runner instead
  // of colliding in the shared tab/PTY/checkout (it drains FIFO when our run
  // becomes the oldest open one). Lifecycle intents (hard_stop/close_session)
  // must always fire to interrupt the running agent. Fail open on a DB hiccup —
  // never block a dispatch on a transient error.
  const lifecycleIntent = promptKey === "hard_stop" || promptKey === "close_session";
  const projectBusy =
    !lifecycleIntent &&
    (await isProjectBusy(userId, canonical, { excludeRunId: runId }).catch(() => false));

  // Name the builder that will run this. A command with no channel is claimable
  // by EVERY runner at once, so leaving it open is a race the always-on box
  // loses to whatever desktop is polling — and closing the lid then kills the
  // work the desktop just claimed. The answer is stored on the project (locus
  // lock, then builder_pref, then the cloud floor) — never guessed from which
  // runner happens to be online.
  // Locus lock always wins. Otherwise a caller-preferred channel (feedback
  // Implement → cloud) overrides the stored laptop pref so phone taps do not
  // queue for a machine nobody is watching.
  const isLifecycle = promptKey === "close_session" || promptKey === "hard_stop";
  // Lifecycle commands (close/stop) have no PTY to act on here and are answered
  // as a no-op, so they are never routed to the hosted builder.
  if (isHostedBuilderPref(dbMatch.builderPref) && !isLifecycle && dbMatch.gitUrl) {
    return await dispatchToHostedBuilder(userId, {
      canonical,
      effectiveTab,
      projectId,
      gitUrl: dbMatch.gitUrl,
      prompt,
      runId,
      eventIntent,
      nowS,
    });
  }
  const pinnedChannel =
    projectChannelLock(dbMatch) ?? params.builderChannel ?? pickDispatchChannel(dbMatch);

  return await executeAndReport(params, userId, {
    dbMatch,
    outcome: {
      effectiveTab,
      canonical,
      projectId,
      resolvedProjectPath,
      ptyWorkspaceId,
      eventAdapter,
      eventIntent,
      eventModel,
      promptKey,
      promptLabel,
      customPrompt,
      prompt,
      runId,
      runtimeAvailable,
      nowS,
    },
    injectFn,
    ptyBacked,
    projectBusy,
    pinnedChannel,
    isLifecycle,
    projectPath,
    runtimeAvailable,
  });
}
