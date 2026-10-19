import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { provisionAgentWorkspace, writeInitialPromptWhenReady } from "@/lib/agent-execution/launch";
import { listAgentRegistry } from "@/lib/agent-registry";
import { isRuntimeAvailable } from "@/lib/runtime";
import { getApiUserId } from "@/lib/session";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";
import { enqueueLaunchAgentCommand } from "@/db/queries/pending-commands";
import { persistProjectRuntimeIfNewer } from "@/db/queries/project-states";
import { stateFile } from "@/lib/agent-config";
import { executionAccessErrorBody, resolveQueuedExecution } from "@/lib/execution-access";
import { workspaceIdFor } from "@/lib/agent-execution/ownership";
import { isDerivedRunTab, runLaneOfTab } from "@/lib/run-tab";

const LaunchAgentBody = z.object({
  tab: z.string().trim().min(1).max(120),
  dir: z.string().trim().min(1).max(500),
  agent: z.string().trim().min(1).max(40),
  model: z.string().trim().max(160).optional(),
  initialPrompt: z.string().trim().max(4000).optional(),
  /** Continue the project's last Claude conversation instead of a new one. */
  resume: z.boolean().optional(),
  /** Pin the builder that should run this launch (the terminal launches into
   *  whichever source the user is looking at). Absent → routing decides. */
  channel: z.enum(BUILDER_CHANNELS).optional(),
});

/**
 * Record the state transition the launch just caused, so the dashboard reflects
 * reality immediately instead of waiting for the next runtime observation to
 * re-discover the new tab. Without this, a freshly launched (and actively
 * working) agent shows a gray dot + "Awaiting input", and downstream features
 * that read "is a tab live" (switch-agent, auto-continue) silently no-op.
 *
 * This writes the *display-state* mirror only — never the prompt-queue transport
 * (which would double-deliver against the initial-prompt write). The write is
 * guarded by runtimeObservedAt, so the next genuine observation supersedes it,
 * and isCurrentPromptStale's absent-agent grace self-heals if the launch failed.
 */
async function recordLaunchedState(
  userId: string,
  tab: string,
  agent: string,
  label: string,
): Promise<void> {
  // The authoritative local Control path (readFastState) reads the running
  // prompt from this /tmp sentinel, not the DB — so without it a freshly
  // launched agent shows no "Working" badge even though it just started. Mirror
  // exactly what /api/inject writes (source "inject" → /proc-backed, so
  // isCurrentPromptStale clears it the moment the agent process exits).
  try {
    const nowS = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      stateFile.prompt(tab),
      JSON.stringify({
        key: "launch",
        label: label.slice(0, 120),
        startedAt: nowS,
        source: "inject",
        adapter: agent,
      }),
    );
  } catch {
    /* best effort — /tmp may be unwritable */
  }

  try {
    const now = new Date();
    await persistProjectRuntimeIfNewer({
      userId,
      projectKey: tab,
      workspaceId: workspaceIdFor(userId, tab),
      tabName: tab,
      agentRunning: true,
      tabOpen: true,
      activeAgents: [agent],
      currentPromptKey: "launch",
      currentPromptLabel: label.slice(0, 120),
      currentPromptStartedAt: now,
      readyAt: null,
      closingAt: null,
      closedAt: null,
      runtimeObservedAt: now,
    });
  } catch {
    /* best effort — never fail the launch on a state-mirror write */
  }
}

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, LaunchAgentBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const { tab, dir, agent, model, initialPrompt, channel, resume } = dataOrResp;
  // A second session of a project is a lane tab ("<project>~<id8>", run-tab.ts).
  // Anything else carrying the reserved separator is not a tab Loki minted.
  if (isDerivedRunTab(tab) && !runLaneOfTab(tab)) {
    return NextResponse.json(
      { error: `Not a session name Loki can open: ${tab}` },
      { status: 400 },
    );
  }
  const registry = listAgentRegistry();
  const exactEntry = registry.find((candidate) => candidate.id === agent);
  if (!exactEntry) {
    return NextResponse.json({ error: `Unknown agent: ${agent}` }, { status: 400 });
  }
  if (isRuntimeAvailable() && !exactEntry.available) {
    return NextResponse.json(
      {
        error:
          exactEntry.availabilityReason ?? `${exactEntry.label} is not available on this machine.`,
      },
      { status: 400 },
    );
  }
  if (!exactEntry.capabilities.tabSwitching) {
    return NextResponse.json(
      { error: `${exactEntry.label} does not support launching into a development tab yet.` },
      { status: 400 },
    );
  }

  if (!isRuntimeAvailable()) {
    const execution = await resolveQueuedExecution(userId, {
      requestedChannel: channel ?? null,
      defaultChannel: "cloud",
    });
    if (!execution.ok) {
      return NextResponse.json(executionAccessErrorBody(execution), { status: execution.status });
    }
    const commandId = await enqueueLaunchAgentCommand(userId, {
      tab,
      ...(execution.channel ? { channel: execution.channel } : {}),
      dir,
      agent,
      model,
      initialPrompt,
      ...(resume ? { resume: true } : {}),
    });
    return NextResponse.json({
      ok: true,
      queued: true,
      mode: "queued",
      commandId,
      tab,
      agent,
      runnerConnected: execution.runnerConnected,
    });
  }

  try {
    // Server-side launch runs the agent in a Loki-owned PTY (not a zellij
    // pane): a headless box has no attached zellij client, so the old
    // go-to-tab-name puppeting blocked forever. The owned PTY is viewable in the
    // browser terminal and needs no attached human terminal. See
    // docs/architecture/agent-execution-platform.md (step 3).
    await provisionAgentWorkspace(userId, { projectKey: tab, dir, agent: exactEntry.id, model });
    const promptText = initialPrompt?.trim();
    await recordLaunchedState(
      userId,
      tab,
      exactEntry.id,
      promptText || `Starting ${exactEntry.label}…`,
    );
    if (promptText) {
      writeInitialPromptWhenReady(userId, tab, promptText);
    }
    return NextResponse.json({ ok: true, tab, agent: exactEntry.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Launch failed: ${message}` }, { status: 500 });
  }
}
