import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { isRuntimeAvailable } from "@/lib/runtime";
import { isAgentId, type AgentOption } from "@/lib/agent-registry";
import { getSessionUserId } from "@/lib/session";
import { enqueueSwitchAgentCommand } from "@/db/queries/pending-commands";
import { resolveOutgoingAgentForDir } from "@/lib/agent-process-scan";
import { workspaceIdFor } from "@/lib/agent-execution/ownership";
import { executionAccessErrorBody, resolveQueuedExecution } from "@/lib/execution-access";
import { sleep } from "@/lib/async";
import { getUserProjects } from "@/db/queries/user-projects";

const SwitchAgentBody = z.object({
  tab: z.string().trim().min(1).max(120),
  dir: z.string().trim().min(1),
  toAgent: z.string().trim().min(1),
  fromAgent: z.string().trim().optional(),
  model: z.string().trim().optional(),
});

export async function POST(req: NextRequest) {
  const dataOrResp = await readJsonBody(req, SwitchAgentBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const { tab, dir, toAgent, fromAgent, model } = dataOrResp;

  if (!isAgentId(toAgent)) {
    return NextResponse.json({ error: `Unknown agent: ${toAgent}` }, { status: 400 });
  }

  // Cloud mode: enqueue for the local runner to execute.
  if (!isRuntimeAvailable()) {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const projects = await getUserProjects(userId).catch(() => []);
    const project = projects.find(
      (candidate) => candidate.name.toLowerCase() === tab.toLowerCase(),
    );
    const execution = await resolveQueuedExecution(
      userId,
      project ? { project } : { defaultChannel: "cloud" },
    );
    if (!execution.ok) {
      return NextResponse.json(executionAccessErrorBody(execution), { status: execution.status });
    }
    const resolvedFrom = resolveOutgoingAgentForDir(dir, fromAgent) ?? fromAgent;
    const commandId = await enqueueSwitchAgentCommand(userId, {
      tab,
      ...(execution.channel ? { channel: execution.channel } : {}),
      dir,
      toAgent,
      fromAgent: resolvedFrom,
      model,
    });
    return NextResponse.json({
      ok: true,
      queued: true,
      mode: "queued",
      commandId,
      fromAgent: resolvedFrom ?? null,
      runnerConnected: execution.runnerConnected,
    });
  }

  // Local runtime: the agent is the owned PTY for this tab. Switching =
  // replacing the owned process: terminate, settle, respawn with the new agent.
  // No quit keystrokes, no /proc hunting — there is nothing else to quit.
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { executor } = await import("@/lib/agent-execution");
    const { provisionAgentWorkspace } = await import("@/lib/agent-execution/launch");
    const workspaceId = workspaceIdFor(userId, tab);
    const live = executor.get(workspaceId);
    const wasLive = !!live && live.status !== "exited";
    if (wasLive) {
      await executor.terminate(workspaceId);
      await sleep(400);
    }
    await provisionAgentWorkspace(userId, {
      projectKey: tab,
      dir,
      agent: toAgent as AgentOption,
      model,
      workspaceId,
    });
    const outgoing = resolveOutgoingAgentForDir(dir, fromAgent);
    return NextResponse.json({
      ok: true,
      toAgent,
      fromAgent: outgoing ?? fromAgent ?? null,
      quitAgents: wasLive && outgoing ? [outgoing] : [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to switch agent" },
      { status: 500 },
    );
  }
}
