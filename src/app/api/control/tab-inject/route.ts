import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { enqueueInjectCommand, enqueueDispatchCommand } from "@/db/queries/pending-commands";
import { getUserProjects } from "@/db/queries/user-projects";
import { getApiUserId } from "@/lib/session";
import { isRuntimeAvailable } from "@/lib/runtime";
import { executor } from "@/lib/agent-execution";
import { workspaceIdFor } from "@/lib/agent-execution/ownership";
import { assembleInjectPrompt } from "@/lib/inject-prompt";
import { AttachmentsField, stageAttachmentsForAgent } from "@/lib/composer-attachments";
import { materializeImages } from "@/lib/agent-attachments-fs";
import { executionAccessErrorBody, resolveQueuedExecution } from "@/lib/execution-access";
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
import type { UserProject } from "@/db/schema";

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

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { tab, prompt, attachments: rawAttachments } = dataOrResp;

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
      project,
      adapter,
      customPrompt: prompt,
      resolvedPrompt: promptToSend,
      promptLabel,
      delivered: true,
    });
    return NextResponse.json({ ok: true, mode: "pty", tab, ...(runId ? { runId } : {}) });
  }

  // No live owned PTY here (cloud host, or local runtime with no session for
  // this tab): queue the self-healing `dispatch` command (launch the agent if
  // none is running → inject → verify) rather than a bare `inject`, which can
  // only reach an agent that already exists. Resolve the project's dir + agent
  // so the runner can cold-start it. Bare inject only when the dir is unknown.
  // Project-aware default: a dirPath-only project (no cloneable repo) can only
  // execute where the directory exists — pin it to the local runner instead of
  // letting the cloud builder invent an empty workspace (BiasLens, 2026-07-14).
  const execution = await resolveQueuedExecution(userId, { project });
  if (!execution.ok) {
    return NextResponse.json(executionAccessErrorBody(execution), { status: execution.status });
  }
  // Record BEFORE enqueue so the command payload carries the runId — the
  // runner's ack (submitted/delivered/undelivered) and the queued-dispatch
  // ordering machinery both key on payload.runId.
  const runId = await recordTabDispatch({
    userId,
    tab,
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
      dir: project.dirPath,
      agent: adapter,
      prompt: promptToSend,
      ...attachments,
      promptLabel,
      model: project.modelPref ?? undefined,
      projectKey: tab,
      ...(runId ? { runId } : {}),
    });
    return NextResponse.json({
      ok: true,
      mode: "dispatch",
      commandId,
      tab,
      ...(runId ? { runId } : {}),
    });
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
  return NextResponse.json({
    ok: true,
    mode: "queued",
    commandId,
    tab,
    ...(runId ? { runId } : {}),
  });
}
