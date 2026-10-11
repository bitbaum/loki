/**
 * Gather one person's build-suggestion inputs — server only.
 *
 * Every read here is one Loki already trusts elsewhere (the /feedback inbox,
 * the daily brief, the sticky notes, the OrangeCat demand feed), so a
 * suggestion and the page it points at cannot disagree. Each read is
 * best-effort: a failed query contributes nothing rather than failing the row,
 * because the row is an invitation, not a report.
 */
import { getUserProjects } from "@/db/queries/user-projects";
import { listUserFeedback } from "@/db/queries/site-feedback";
import { getStuckGoals, listUpcomingCommitments } from "@/db/queries/today";
import { listCaptures } from "@/db/queries/captures";
import { fetchOpenDemand } from "@/lib/integrations/orangecat-demand";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { listSuggestionDecisions } from "@/db/queries/suggestion-decisions";
import { hiddenIds } from "@/lib/suggestions/board";
import { DAY_MS } from "@/lib/constants/time";
import { toLocalDateStr } from "@/lib/dates";
import type { UserProject } from "@/db/schema/user-projects";
import {
  rankBuildSuggestions,
  type BuildSuggestion,
  type SuggestionInputs,
  type SuggestionProject,
} from "./rank";

const DEADLINE_DAYS = 3;
const CAPTURE_LIMIT = 12;
const DEMAND_LIMIT = 8;

function toSuggestionProject(p: UserProject): SuggestionProject {
  const last = [...(p.devLog ?? [])].reverse().find((e) => e.next?.trim());
  return {
    name: p.name,
    description: p.description,
    stack: p.stack,
    liveUrl: p.liveUrl,
    runnable: Boolean(p.gitUrl || p.dirPath),
    nextStep: last?.next.trim().split("\n")[0] ?? null,
    nextStepDate: last?.date ?? null,
  };
}

export async function loadSuggestionInputs(userId: string): Promise<SuggestionInputs> {
  const [projects, feedback, stuck, commitments, captures, demand] = await Promise.all([
    getUserProjects(userId).catch(() => []),
    listUserFeedback(userId, 200).catch(() => []),
    getStuckGoals(userId).catch(() => []),
    listUpcomingCommitments(userId, DEADLINE_DAYS).catch(() => []),
    listCaptures(userId, CAPTURE_LIMIT).catch(() => []),
    fetchOpenDemand().catch(() => null),
  ]);

  const openFeedback: Record<string, number> = {};
  for (const f of feedback) {
    if (f.status !== FEEDBACK_STATUS.NEW) continue;
    openFeedback[f.projectName] = (openFeedback[f.projectName] ?? 0) + 1;
  }

  const now = Date.now();
  return {
    projects: projects.map(toSuggestionProject),
    openFeedback,
    stuckGoals: stuck.map((g) => ({ title: g.title, projectName: g.entityName ?? null })),
    commitmentsDue: commitments.map((c) => ({
      description: c.description,
      due: c.dueDate ? toLocalDateStr(new Date(c.dueDate)) : "soon",
    })),
    captures: captures.map((c) => ({
      body: c.body,
      ageDays: Math.max(0, Math.floor((now - new Date(c.createdAt).getTime()) / DAY_MS)),
    })),
    demand: (demand?.needs ?? []).slice(0, DEMAND_LIMIT),
  };
}

export async function loadBuildSuggestions(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ suggestions: BuildSuggestion[]; total: number }> {
  const [inputs, decisions] = await Promise.all([
    loadSuggestionInputs(userId),
    listSuggestionDecisions(userId).catch(() => []),
  ]);
  return rankBuildSuggestions(inputs, { ...opts, exclude: hiddenIds(decisions, new Date()) });
}
