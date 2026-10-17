import { NextRequest, NextResponse } from "next/server";
import {
  readAgentPreferences,
  resolveAgentConfig,
  writeAgentPreferences,
} from "@/lib/agent-preferences";
import { buildSwitchableAgentCatalog, type AgentCatalog } from "@/lib/agent-catalog";
import { AGENT_IDS, type Agent } from "@/lib/agent-registry";
import { workspaceIdFor } from "@/lib/agent-execution/ownership";
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import { getSessionUserId } from "@/lib/session";
import { isSiteOperator } from "@/db/queries/users";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { isRuntimeAvailable } from "@/lib/runtime";
import { enqueueSwitchAgentCommand } from "@/db/queries/pending-commands";
import { resolveQueuedExecution } from "@/lib/execution-access";

const UpdateAgentBody = z.object({
  agent: z.enum(AGENT_IDS),
  model: z.string().trim().min(1, "model is required").max(120, "model too long"),
  applyToOpenTabs: z.boolean().optional(),
});

type SwitchTabResult = {
  tab?: string;
  dir?: string;
  command?: string;
  // "queued" is the cloud-mode outcome: a switch_agent pending_command was
  // enqueued for the runner to execute. Local mode restarts owned PTYs inline
  // and reports restarted/skipped/failed.
  status: "restarted" | "skipped" | "failed" | "queued";
  reason?: string;
  error?: string;
};

type AgentRegistry = AgentCatalog;

export async function GET() {
  const prefs = readAgentPreferences();
  const config = resolveAgentConfig(prefs);
  const registry: AgentRegistry = buildSwitchableAgentCatalog(prefs.models, config.agent);

  return NextResponse.json({ registry, config });
}

/**
 * Local runtime: restart every project that has a live owned PTY with the new
 * agent/model. A project with no live session is skipped — there is nothing
 * to restart, and starting one is a dispatch, not a preference change.
 */
async function applyToOpenTabs(
  userId: string,
  agent: Agent,
  model: string,
  allProjects: { tab: string; dir: string }[],
): Promise<SwitchTabResult[]> {
  if (allProjects.length === 0) {
    return [{ status: "skipped", reason: "No configured projects found." }];
  }
  const { executor } = await import("@/lib/agent-execution");
  const { provisionAgentWorkspace } = await import("@/lib/agent-execution/launch");
  const results: SwitchTabResult[] = [];
  for (const { tab, dir } of allProjects) {
    const workspaceId = workspaceIdFor(userId, tab);
    const live = executor.get(workspaceId);
    if (!live || live.status === "exited") {
      results.push({ tab, dir, status: "skipped" as const, reason: "No running agent." });
      continue;
    }
    try {
      await executor.terminate(workspaceId);
      await new Promise((r) => setTimeout(r, 400));
      await provisionAgentWorkspace(userId, { projectKey: tab, dir, agent, model, workspaceId });
      results.push({ tab, dir, status: "restarted" as const });
    } catch (error) {
      results.push({
        tab,
        dir,
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function POST(req: NextRequest) {
  // The preferences file (~/.config/loki-agent.json) and the Claude settings
  // it syncs are the MACHINE's. On a person's own desktop app that machine is
  // theirs; on the shared server it is the operator's and the cloud
  // builder's, and until 2026-10-17 any account's "Default agent and model"
  // save rewrote it for everyone.
  const sessionUserId = await getSessionUserId();
  if (!sessionUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isRuntimeAvailable() && !(await isSiteOperator(sessionUserId).catch(() => false))) {
    return NextResponse.json(
      {
        error:
          "The default agent on Loki's own computers is set by the site operator. On your computer, set it in the desktop app.",
      },
      { status: 403 },
    );
  }

  const dataOrResp = await readJsonBody(req, UpdateAgentBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  try {
    const current = readAgentPreferences();
    const next = writeAgentPreferences({
      ...current,
      defaultAgent: dataOrResp.agent,
      models: {
        ...current.models,
        [dataOrResp.agent]: dataOrResp.model,
      },
    });

    let tabResults: SwitchTabResult[] = [];
    if (dataOrResp.applyToOpenTabs) {
      const userId = await getSessionUserId();
      if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const [dbProjects, dbTeamProjects] = await Promise.all([
        getUserProjects(userId).catch(() => []),
        getOrgProjects(userId).catch(() => []),
      ]);
      const seenDirs = new Set<string>();
      const allProjects = [...dbProjects, ...dbTeamProjects]
        .filter((p) => p.dirPath && !seenDirs.has(p.dirPath) && seenDirs.add(p.dirPath))
        .map((p) => ({ tab: p.name, dir: p.dirPath! }));

      if (!isRuntimeAvailable()) {
        // Cloud mode: instead of returning "skipped" and silently doing
        // nothing, queue a switch_agent command per project. The local
        // runner's execute_switch_agent (hardened in 0ccb43d/9a3bd61)
        // handles tab-not-open as a no-op via its quit signal path, so
        // queueing for every registered project is safe. Runner also
        // falls back to conf model if model is empty (9a3bd61).
        const execution = await resolveQueuedExecution(userId, { defaultChannel: "cloud" });
        if (!execution.ok) {
          tabResults = allProjects.map(({ tab, dir }) => ({
            tab,
            dir,
            status: "failed" as const,
            error: execution.message,
          }));
        } else {
          tabResults = await Promise.all(
            allProjects.map(async ({ tab, dir }): Promise<SwitchTabResult> => {
              try {
                await enqueueSwitchAgentCommand(userId, {
                  tab,
                  ...(execution.channel ? { channel: execution.channel } : {}),
                  dir,
                  toAgent: dataOrResp.agent,
                  model: dataOrResp.model,
                });
                return { tab, dir, status: "queued" as const };
              } catch (err) {
                return {
                  tab,
                  dir,
                  status: "failed" as const,
                  error: err instanceof Error ? err.message : String(err),
                };
              }
            }),
          );
        }
      } else {
        tabResults = await applyToOpenTabs(userId, dataOrResp.agent, dataOrResp.model, allProjects);
      }
    }

    return NextResponse.json({
      ok: true,
      config: resolveAgentConfig(next),
      preferences: next,
      tabResults,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
