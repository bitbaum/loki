import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import { mergeVisibleProjects } from "@/lib/visible-projects";
import { getProjectStatesByUserId } from "@/db/queries/project-states";
import { getRecentOutcomesByProjectKeys } from "@/db/queries/orchestration-runs";

/**
 * Lean fleet status for Loki (the `loki_fleet_status` tool) — token-authed
 * (ck_* bearer or session). Returns raw per-project signals; the agent narrates
 * them ("datacat is working, 2 queued; revampit is blocked awaiting you").
 */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [own, org, states] = await Promise.all([
    getUserProjects(userId).catch(() => []),
    getOrgProjects(userId).catch(() => []),
    getProjectStatesByUserId(userId).catch(() => []),
  ]);
  const projects = mergeVisibleProjects(own, org);
  const stateByKey = new Map(states.map((s) => [s.projectKey.toLowerCase(), s]));
  const outcomes = await getRecentOutcomesByProjectKeys(
    userId,
    projects.map((p) => p.name),
  ).catch(() => new Map<string, string[]>());

  const fleet = projects.map((p) => {
    const s = stateByKey.get(p.name.toLowerCase());
    return {
      name: p.name,
      dir: p.dirPath ?? null,
      agent: p.agentPref ?? null,
      agentRunning: s?.agentRunning ?? false,
      tabOpen: s?.tabOpen ?? false,
      sessionStatus: s?.sessionStatus ?? null, // "ready" | "working" | null
      blockReason: s?.sessionBlockReason ?? null, // awaiting_user | external_dependency | manual_pause
      noOpCount: s?.sessionNoOpCount ?? null,
      queueDepth: s?.promptQueue?.length ?? 0,
      currentWork: s?.currentPromptLabel ?? null,
      recentOutcomes: outcomes.get(p.name) ?? [], // newest first: success|partial|error|hang|user_abort|timeout
    };
  });

  const summary = {
    total: fleet.length,
    running: fleet.filter((f) => f.agentRunning).length,
    blocked: fleet.filter((f) => f.blockReason).length,
    queued: fleet.filter((f) => f.queueDepth > 0).length,
  };
  return NextResponse.json({ ok: true, summary, projects: fleet });
}
