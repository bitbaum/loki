/**
 * GET /api/terminal/context?channel=cloud|local
 *
 * Everything the terminal's mode bar needs, and nothing else: the agent
 * catalog (with runner-reported availability) plus, per open tab, the working
 * directory and the agent currently preferred there.
 *
 * Deliberately NOT `/api/control` — that route assembles git state, queues,
 * activity timelines and outcome streaks for every project. The terminal needs
 * three fields per tab. Reusing the heavy route would have made opening a
 * terminal cost a full Control refresh on a 5s cadence.
 *
 * SSOT is preserved: the catalog is built by the same
 * `buildSwitchableAgentCatalog` + runner-availability derivation the Control
 * route uses, and tab→dir comes from `user_projects` exactly as tab-inject
 * resolves it.
 */
import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { isRuntimeAvailable } from "@/lib/runtime";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";
import { z } from "@/lib/api/route-helpers";
import { listAgentRegistry } from "@/lib/agent-registry";
import {
  buildSwitchableAgentCatalog,
  type AgentAvailabilityOverride,
  type AgentCatalog,
} from "@/lib/agent-catalog";
import { getUserProjects } from "@/db/queries/user-projects";
import { getRuntimeSnapshot } from "@/db/queries/runtime-snapshots";
import { readAgentPreferences, resolveAgentConfig } from "@/lib/agent-preferences";

export const runtime = "nodejs";

const Channel = z.enum(BUILDER_CHANNELS);

/** One open tab, resolved to the things the mode bar can act on. */
export type TerminalTabContext = {
  tab: string;
  /** Absolute project directory — required by /api/control/switch-agent. */
  dir: string | null;
  /** Preferred agent for this tab, if the project records one. */
  agentPref: string | null;
  /** Registered project this tab resolves to — by name, else by pane cwd. */
  projectName: string | null;
  /** user_projects id for that project — what /api/providers scopes on. */
  projectId: string | null;
  /** Agent CLIs actually running in this tab's panes ("claude", "grok", …),
   *  from the runner's pane topology. Empty when unknown or shell-only. */
  liveAgents: string[];
};

/** A project the terminal can start an agent in, when nothing is running. */
export type TerminalLaunchProject = {
  name: string;
  dir: string;
  agentPref: string | null;
};

export type TerminalContext = {
  agents: AgentCatalog;
  tabs: TerminalTabContext[];
  /** Same eligibility rule as Control's launch modal: a linked directory. */
  launchable: TerminalLaunchProject[];
};

export async function GET(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Channel.safeParse(new URL(req.url).searchParams.get("channel"));
  const channel = parsed.success ? parsed.data : undefined;

  const [projects, snapshot] = await Promise.all([
    getUserProjects(userId).catch(() => []),
    getRuntimeSnapshot(userId, channel).catch(() => null),
  ]);
  const preferences = readAgentPreferences();
  const agentConfig = resolveAgentConfig(preferences);

  // Availability mirrors /api/control: on the local runtime host the adapters
  // detect themselves; on the control plane only the connected runner knows
  // what is installed, and a runner that reported nothing means "unknown",
  // which must read as usable rather than as a wall of disabled rows.
  const agentIds = listAgentRegistry().map((entry) => entry.id);
  const installedAgents = snapshot?.installedAgents ?? [];
  const availability: AgentAvailabilityOverride | undefined = isRuntimeAvailable()
    ? undefined
    : (Object.fromEntries(
        agentIds.map((agent) => [
          agent,
          installedAgents.length === 0 || installedAgents.includes(agent),
        ]),
      ) as AgentAvailabilityOverride);

  const agents = buildSwitchableAgentCatalog(preferences.models, agentConfig.agent, availability);

  // Tab names are matched case-insensitively against project names — the same
  // rule /api/control/tab-inject uses to resolve a tab to a project. When the
  // tab is generically named ("Tab #1"), the runner's pane topology still knows
  // the working directory, so a cwd→dirPath match recovers the project — and
  // with it the strip label, the agent switcher, and the composer target.
  const byName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
  const panes = snapshot?.panes ?? [];
  const projectForCwd = (cwd: string | undefined) =>
    cwd
      ? projects.find((p) => p.dirPath && (cwd === p.dirPath || cwd.startsWith(`${p.dirPath}/`)))
      : undefined;
  const tabs: TerminalTabContext[] = (snapshot?.openTabs ?? []).map((tab) => {
    const tabPanes = panes.filter((p) => p.tab.toLowerCase() === tab.toLowerCase());
    const project =
      byName.get(tab.toLowerCase()) ?? tabPanes.map((p) => projectForCwd(p.cwd)).find(Boolean);
    const liveAgents = [
      ...new Set(tabPanes.map((p) => p.agentCli).filter((a): a is string => Boolean(a))),
    ];
    return {
      tab,
      dir: project?.dirPath ?? null,
      agentPref: project?.agentPref ?? null,
      projectName: project?.name ?? null,
      projectId: project?.id ?? null,
      liveAgents,
    };
  });

  const launchable: TerminalLaunchProject[] = projects
    .filter((p) => p.dirPath)
    .map((p) => ({ name: p.name, dir: p.dirPath!, agentPref: p.agentPref ?? null }));

  return NextResponse.json({ agents, tabs, launchable } satisfies TerminalContext);
}
