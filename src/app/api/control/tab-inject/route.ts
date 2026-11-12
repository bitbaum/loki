import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import {
  enqueueInjectCommand,
  enqueueDispatchCommand,
  findQueueBlockers,
} from "@/db/queries/pending-commands";
import { getUserProjects } from "@/db/queries/user-projects";
import { getApiUserId } from "@/lib/session";
import { resolveDriveTarget } from "@/db/queries/session-drive";
import { isRuntimeAvailable } from "@/lib/runtime";
import { executor } from "@/lib/agent-execution";
import { workspaceIdFor } from "@/lib/agent-execution/ownership";
import { assembleInjectPrompt } from "@/lib/inject-prompt";
import { AttachmentsField, stageAttachmentsForAgent } from "@/lib/composer-attachments";
import { materializeImages } from "@/lib/agent-attachments-fs";
import {
  coldStartWorkspaceDir,
  executionAccessErrorBody,
  offlineFallbackChannel,
  resolveQueuedExecution,
} from "@/lib/execution-access";
import { queuedBehindSentence, rerouteNotice } from "@/lib/dispatch-status";
import {
  DEFAULT_ADAPTER_ID,
  ORCHESTRATION_ADAPTER_IDS,
  ORCH_STATE,
  type AdapterId,
} from "@/lib/orchestration";
import { insertPromptHistory } from "@/db/queries/prompt-history";
import { createOrchestrationRun } from "@/db/queries/orchestration-runs";
import { createOrchestrationEvent } from "@/db/queries/orchestration-events";
import { emitRunEvent } from "@/db/queries/run-events";
import { injectPrompt } from "@/lib/inject-core";
import { sessionOpenUrl } from "@/lib/dispatch-card";
import type { UserProject } from "@/db/schema";
import { isShellTab } from "@/lib/shell-session";

const Body = z.object({
  tab: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(4000),
  /** Screenshots and text files staged in the composer — see
   *  lib/composer-attachments for why an image becomes text before it ships. */
  attachments: AttachmentsField,
});

// Every successful tab-inject dispatch enters the same activity ledger as
// /api/inject (prompt_history + tracked run + orchestration event). Without
// this, work dispatched from the terminal composer / "Send to terminal" was
// invisible in Activity, Control's timeline, recent prompts, and digests —
// the ledger only knew dispatches routed through inject-core. The run is
// closed later by the control poll when the agent's session handoff reports
// ready (closeRunFromSession), identical to inject-core-opened runs.
async function recordTabDispatch(opts: {
  userId: string;
  tab: string;
  project: UserProject | undefined;
  adapter: AdapterId;
  customPrompt: string;
  resolvedPrompt: string;
  promptLabel: string;
  /** The prompt was already written into a live session before this call (pty
   *  write / zellij inject). Stamps deliveredAt at creation so the close path
   *  can read a MISSING stamp as proof the prompt never landed — the queued
   *  path gets the same stamp later, from the runner ack. */
  delivered?: boolean;
  /** A member driving the owner's session by the owner's grant (lib/session-drive). */
  drivenBy?: string | null;
}): Promise<string | null> {
  const { userId, tab, project, adapter } = opts;
  const projectId = project?.entityProjectId ?? null;
  const projectKey = project?.name ?? tab;
  const projectPath = project?.dirPath ?? "";

  let runId: string | null = null;
  // A tracked run needs a real project directory for the close signal to find
  // it; a tab with no registered project still gets a prompt_history row so
  // the dispatch is at least auditable.
  if (project?.dirPath) {
    try {
      const run = await createOrchestrationRun({
        userId,
        projectId,
        adapter,
        intent: "custom",
        state: ORCH_STATE.WAITING,
        projectKey,
        projectPath,
        payload: {
          projectId,
          projectKey,
          projectPath,
          ...(opts.delivered ? { deliveredAt: new Date().toISOString() } : {}),
          ...(opts.drivenBy ? { drivenBy: opts.drivenBy } : {}),
        },
      });
      runId = run.id;
      void emitRunEvent(run.id, userId, "dispatched", {
        intent: "custom",
        projectKey,
        promptLabel: opts.promptLabel,
      });
    } catch (err) {
      console.error("[tab-inject] tracked-run create failed:", err);
    }
  }

  insertPromptHistory(userId, {
    projectId,
    projectKey,
    projectPath,
    adapter,
    intent: "custom",
    customPrompt: opts.customPrompt,
    resolvedPrompt: opts.resolvedPrompt,
    // The run opened above, when this tab had a registered project; a
    // project-less tab keeps its auditable prompt row with no run to join.
    runId,
  }).catch((err) => console.error("[tab-inject] db write failed:", err));

  createOrchestrationEvent({
    userId,
    projectId,
    projectKey,
    eventType: "continue_requested",
    source: "api-tab-inject",
    adapter,
    intent: "custom",
    detail: opts.promptLabel,
    happenedAt: new Date(),
  }).catch((err) => console.error("[tab-inject] db write failed:", err));

  return runId;
}

/**
 * A queued task names the open run it waits behind, when it does.
 *
 * On the cloud builder a task for a project whose last run is still open waits
 * its turn: the claim gate (pending-commands fifoEligibilitySql) holds it
 * until that run closes or goes idle, so it is never typed into an agent
 * mid-task. The answer said only `ok`, and a caller took "queued" for "the
 * agent has it". Same fields and sentence as /api/inject (inject-core):
 * findQueueBlockers reads the gate's own predicate, queuedBehindSentence says it.
 */
async function withHold(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  // A live PTY here waits for nothing; inject-core already said it for its answers.
  if (!runId || body.mode === "pty" || body.waitingOn || body.queuedBehind) return body;
  const blocker = (await findQueueBlockers([runId]).catch(() => new Map())).get(runId);
  if (!blocker) return body;
  return {
    ...body,
    queuedBehind: true,
    waitingOn: {
      runId: blocker.runId,
      label: blocker.label,
      since: blocker.startedAt.toISOString(),
      lastProgressAt: blocker.lastProgressAt?.toISOString() ?? null,
    },
    message: [typeof body.message === "string" ? body.message : null, queuedBehindSentence(blocker)]
      .filter(Boolean)
      .join(" "),
  };
}

export async function POST(req: NextRequest) {
  const callerId = await getApiUserId();
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { prompt, attachments: rawAttachments } = dataOrResp;
  // A plain shell takes keys from a signed-in, unlocked person only
  // (tab-inject-raw); a prompt for one was queued here, answered 200, and then
  // refused by the runner, so the caller was told it worked.
  if (isShellTab(dataOrResp.tab)) {
    return NextResponse.json(
      { error: "A shell takes keys from its owner's unlocked browser, not prompts." },
      { status: 403 },
    );
  }
  // The caller's own session, or the one project session its owner lets this
  // member drive (lib/session-drive.ts). From here on the session is the
  // owner's: their builder, their project folder, their run ledger, with the
  // member named on the run.
  const target = await resolveDriveTarget(callerId, dataOrResp.tab);
  const userId = target.ownerId;
  const tab = target.tab;
  const drivenBy = target.kind === "granted" ? target.drivenBy : null;

  // Stage attachments BEFORE project context is assembled, so the screenshot
  // is part of the task the agent is given rather than a trailer after the
  // conventions block. Images travel with the command as files-to-be; their
  // placeholders become paths where the agent runs (lib/agent-attachments).
  const staged = stageAttachmentsForAgent(prompt, rawAttachments);
  const promptWithAttachments = staged.prompt;
  const attachments = staged.images.length > 0 ? { attachments: staged.images } : {};
  const projects = await getUserProjects(userId);
  const project = projects.find((p) => p.name.toLowerCase() === tab.toLowerCase());
  const adapter: AdapterId =
    project?.agentPref &&
    (ORCHESTRATION_ADAPTER_IDS as readonly string[]).includes(project.agentPref)
      ? (project.agentPref as AdapterId)
      : DEFAULT_ADAPTER_ID;
  const assembled = project?.dirPath
    ? await assembleInjectPrompt({
        userId,
        projectKey: project.name,
        projectPath: project.dirPath,
        projectId: project.entityProjectId ?? null,
        adapter,
        customPrompt: promptWithAttachments,
        model: project.modelPref ?? undefined,
      })
    : null;
  const promptToSend = assembled?.ok ? assembled.prompt : promptWithAttachments;
  // The LABEL stays the words the human typed. An attachment can add thousands
  // of characters of machine-written description, and labelling the dispatch
  // with the top of that makes every screenshot-driven task read identically
  // in Activity and prompt history.
  const promptLabel = assembled?.ok ? assembled.promptLabel : prompt.slice(0, 40);

  // A Loki-owned PTY agent is driven directly via the executor — no zellij.
  const wsId = workspaceIdFor(userId, tab);
  const wsHandle = isRuntimeAvailable() ? executor.get(wsId) : null;
  if (wsHandle && wsHandle.status !== "exited") {
    const { stateFile, clearHandshakeFiles } = await import("@/lib/agent-config");
    const fs = await import("fs");
    const nowS = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      stateFile.prompt(tab),
      JSON.stringify({
        key: "custom",
        label: promptLabel,
        startedAt: nowS,
        source: "inject",
        adapter,
      }),
    );
    clearHandshakeFiles(tab);
    // This process IS where the agent runs: write the screenshots here.
    const local = materializeImages(promptToSend, staged.images);
    executor.write(wsId, local.endsWith("\r") ? local : `${local}\r`);
    const runId = await recordTabDispatch({
      userId,
      tab,
      drivenBy,
      project,
      adapter,
      customPrompt: prompt,
      resolvedPrompt: promptToSend,
      promptLabel,
      delivered: true,
    });
    return NextResponse.json({
      ok: true,
      mode: "pty",
      tab,
      openUrl: sessionOpenUrl(tab, null, runId ?? null),
      ...(runId ? { runId } : {}),
    });
  }

  // No live owned PTY here (cloud host, or local runtime with no session for
  // this tab): queue the self-healing `dispatch` command (launch the agent if
  // none is running → inject → verify) rather than a bare `inject`, which can
  // only reach an agent that already exists. Resolve the project's dir + agent
  // so the runner can cold-start it. Bare inject only when the dir is unknown.
  // Project-aware default: a dirPath-only project (no cloneable repo) can only
  // execute where the directory exists — pin it to the local runner instead of
  // letting the cloud builder invent an empty workspace (BiasLens, 2026-07-14).
  // A registered project with no directory on any machine yet — only a
  // repository — is the inject core's to start: it cold-starts the agent in
  // the folder the builder clones into, picks the builder the project stores,
  // and opens its own tracked run. Queuing a bare `inject` here instead asked
  // the builder to type into an agent that did not exist ("no running agent
  // for 'substrata' on this runner", 2026-10-21), so Send to terminal failed
  // on every repo-only project. One path, shared with /api/inject.
  if (project && !project.dirPath) {
    const { status, body } = await injectPrompt(
      {
        tab: project.name,
        ...(project.entityProjectId ? { projectId: project.entityProjectId } : {}),
        customPrompt: promptWithAttachments,
        ...(staged.images.length > 0 ? { attachments: staged.images } : {}),
      },
      userId,
    );
    return NextResponse.json(status === 200 ? await withHold(body) : body, { status });
  }

  // The project's own builder is off and the cloud runner can clone it: the
  // work goes where it can start now, as it does from the chat (inject-core).
  // Without the fallback this composer queued for a computer that was shut and
  // answered "dispatch" with nothing else; the row then sat until the reaper
  // closed it an hour later (the owner's laptop was offline from 2026-11-11
  // 07:19, and every project registered from it was still pinned to it).
  const execution = await resolveQueuedExecution(userId, {
    project,
    offlineFallback: project ? offlineFallbackChannel(project) : null,
  });
  if (!execution.ok) {
    return NextResponse.json(executionAccessErrorBody(execution), { status: execution.status });
  }
  const reroutedFrom = execution.reroutedFrom ?? null;
  const rerouted = rerouteNotice(execution.channel ?? null, reroutedFrom);
  // Record BEFORE enqueue so the command payload carries the runId — the
  // runner's ack (submitted/delivered/undelivered) and the queued-dispatch
  // ordering machinery both key on payload.runId.
  const runId = await recordTabDispatch({
    userId,
    tab,
    drivenBy,
    project,
    adapter,
    customPrompt: prompt,
    resolvedPrompt: promptToSend,
    promptLabel,
  });
  if (project?.dirPath) {
    const commandId = await enqueueDispatchCommand(userId, {
      tab,
      ...(execution.channel ? { channel: execution.channel } : {}),
      // On the other builder the project's stored folder is another machine's
      // path; the cloud runner starts in the folder it clones into.
      dir: reroutedFrom
        ? (coldStartWorkspaceDir(project.name, project.gitUrl) ?? project.dirPath)
        : project.dirPath,
      agent: adapter,
      prompt: promptToSend,
      ...attachments,
      promptLabel,
      model: project.modelPref ?? undefined,
      projectKey: tab,
      ...(runId ? { runId } : {}),
    });
    return NextResponse.json(
      await withHold({
        ok: true,
        mode: "dispatch",
        commandId,
        tab,
        // Which builder has it, and in a sentence when that is not the one the
        // project is set to: nobody should have to guess where their work went.
        ...(execution.channel ? { channel: execution.channel } : {}),
        runnerConnected: execution.runnerConnected,
        ...(reroutedFrom ? { reroutedFrom } : {}),
        ...(rerouted ? { message: rerouted } : {}),
        openUrl: sessionOpenUrl(tab, execution.channel ?? null, runId ?? null),
        ...(runId ? { runId } : {}),
      }),
    );
  }

  const commandId = await enqueueInjectCommand(userId, {
    tab,
    ...(execution.channel ? { channel: execution.channel } : {}),
    prompt: promptToSend,
    ...attachments,
    promptKey: "",
    promptLabel,
    adapter,
    ...(runId ? { runId } : {}),
  });
  return NextResponse.json(
    await withHold({
      ok: true,
      mode: "queued",
      commandId,
      tab,
      openUrl: sessionOpenUrl(tab, execution.channel ?? null, runId ?? null),
      ...(runId ? { runId } : {}),
    }),
  );
}
