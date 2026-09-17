/**
 * Project dossier — the SSOT assembly behind the full project page
 * (/projects/[id]): everything a captain (or an agent) needs to answer
 * "what happened, where are we, what's next" for one project, composed
 * entirely from EXISTING sources of truth. No new tables, no parallel state:
 *
 *   Done — user_projects.devLog (the changelog) + orchestration_runs
 *          (outcomes, commits, durations)
 *   Now  — project_states (live runner state) + entity attributes
 *          (mission/status/brief) via getProjectDetail
 *   Next — latest handoff `next:` + linked goals + attrs.next_step
 *
 * Deliberately deterministic — no vector retrieval. pgvector earns its keep
 * for similarity ACROSS projects (fleet-RAG, already injected into
 * dispatches); a single project's dossier is a few KB and must be exact,
 * not similar. getProjectContext uses this same assembly so the page a human
 * reads and the exact context an agent receives cannot drift apart.
 */
import { resolveProjectDetailWithOrgFallback, type ProjectDetail } from "./projects";
import { db } from "@/db";
import { entities, userProjects } from "@/db/schema";
import { and, eq, ilike } from "drizzle-orm";
import { getProjectStateForProject } from "./project-states";
import { projectStateKeys } from "@/lib/project-build-status";
import { getProjectActivity, type ProjectActivityEvent } from "./activity";
import {
  getProjectOrchestrationRuns,
  getRecentOutcomes,
  type RecentOutcome,
} from "./orchestration-runs";
import { getUserProjectByEntityId } from "./user-projects";
import { cleanDescription } from "@/lib/project-display";
import { getProjectShareByToken } from "./project-shares";
import type { UserProject } from "@/db/schema";
import type { orchestrationRuns } from "@/db/schema/orchestration-runs";
import type { ProjectShare } from "@/db/schema/project-shares";
import { ENTITY_TYPE } from "@/lib/constants/statuses";
import { renderOperatingPrinciples } from "@/config/operating-principles";
import { getGithubToken } from "@/lib/github-token";
import { fetchRecentGithubCommits, type RepoCommit } from "@/lib/github-commits";
import { computeProjectHealth, describeProjectHealth } from "@/lib/project-health";
import { getOrangeCatLinksForProject } from "./orangecat-links";
import type { OrangeCatEntityLink } from "@/db/schema";
import {
  fetchOrangeCatFundingSummary,
  type OrangeCatFundingSummary,
} from "@/lib/integrations/orangecat-funding";

export type ProjectRunRow = typeof orchestrationRuns.$inferSelect;

export type ProjectDossier = {
  detail: ProjectDetail;
  ownerId: string;
  /** Viewer is an org peer, not the owner — page renders read-only. */
  readonly: boolean;
  /** Project editor capability is narrower than ownership: editors can work
   * feedback without changing billing, identity, or membership. */
  canEditFeedback: boolean;
  state: Awaited<ReturnType<typeof getProjectStateForProject>> | null;
  activity: ProjectActivityEvent[];
  runs: ProjectRunRow[];
  outcomes: RecentOutcome[];
  /** The runtime row (devLog lives on detail; this adds gitUrl/dirPath/OC link). */
  userProject: UserProject | null;
  /** Typed public/economic edges into OrangeCat. */
  orangecatLinks: OrangeCatEntityLink[];
  orangecatFunding: OrangeCatFundingSummary | null;
  /** Recent repo commits — evidence of real work even when no Loki run
   *  produced it. null when the project has no GitHub repo or no linked token. */
  commits: RepoCommit[] | null;
  /** Wall-clock at build time — the ONE `now` the render uses to age handoffs
   *  and run outcomes, so components stay pure (no Date.now() in render). */
  builtAtMs: number;
};

export type SharedProjectDossier = {
  dossier: ProjectDossier;
  share: ProjectShare;
};

export async function getProjectDossier(
  viewerUserId: string,
  projectId: string,
): Promise<ProjectDossier | null> {
  const resolved = await resolveProjectDetailWithOrgFallback(viewerUserId, projectId);
  if (!resolved) return null;
  const { detail, ownerId, canEdit } = resolved;
  const projectKey = detail.project.name;

  const [activity, runs, outcomes, userProject] = await Promise.all([
    getProjectActivity(ownerId, projectKey, { days: 90, limit: 60 }).catch(() => []),
    getProjectOrchestrationRuns(ownerId, projectId, 25).catch(() => []),
    getRecentOutcomes(ownerId, projectKey, { limit: 10 }).catch(() => []),
    getUserProjectByEntityId(ownerId, projectId).catch(() => null),
  ]);
  // After userProject: the runner keys its row by the checkout directory, and
  // only the catalog row knows what that is.
  const state = await getProjectStateForProject(
    ownerId,
    projectId,
    projectStateKeys({
      name: projectKey,
      userProjectName: userProject?.name,
      dirPath: userProject?.dirPath,
      gitUrl: userProject?.gitUrl ?? detail.project.gitUrl,
    }),
  ).catch(() => null);

  const gitUrl = userProject?.gitUrl ?? detail.project.gitUrl;
  const orangecatLinks = userProject
    ? await getOrangeCatLinksForProject(ownerId, userProject.id).catch(() => [])
    : [];
  const fundingLink =
    orangecatLinks.find((link) => link.role === "funding") ??
    orangecatLinks.find((link) => link.role === "public_profile") ??
    orangecatLinks[0];
  const orangecatFunding = await fetchOrangeCatFundingSummary(fundingLink);
  const commits = gitUrl
    ? await getGithubToken(ownerId)
        .then((token) => (token ? fetchRecentGithubCommits(gitUrl, token) : null))
        .catch(() => null)
    : null;

  return {
    detail,
    ownerId,
    readonly: ownerId !== viewerUserId,
    canEditFeedback: canEdit,
    state,
    activity,
    runs,
    outcomes,
    userProject,
    orangecatLinks,
    orangecatFunding,
    commits,
    builtAtMs: Date.now(),
  };
}

export async function getProjectDossierByOwner(
  ownerUserId: string,
  projectId: string,
): Promise<ProjectDossier | null> {
  const dossier = await getProjectDossier(ownerUserId, projectId);
  return dossier && dossier.ownerId === ownerUserId ? dossier : null;
}

export async function getProjectDossierByProjectKey(
  ownerUserId: string,
  projectKey: string,
): Promise<ProjectDossier | null> {
  const [project, runtimeProject] = await Promise.all([
    db.query.entities.findFirst({
      where: and(
        eq(entities.userId, ownerUserId),
        eq(entities.type, ENTITY_TYPE.PROJECT),
        ilike(entities.name, projectKey),
      ),
      columns: { id: true },
    }),
    db.query.userProjects.findFirst({
      where: and(eq(userProjects.userId, ownerUserId), ilike(userProjects.name, projectKey)),
      columns: { entityProjectId: true },
    }),
  ]);
  const projectId = project?.id ?? runtimeProject?.entityProjectId;
  return projectId ? getProjectDossierByOwner(ownerUserId, projectId) : null;
}

export async function getSharedProjectDossier(token: string): Promise<SharedProjectDossier | null> {
  const share = await getProjectShareByToken(token);
  if (!share) return null;
  const dossier = await getProjectDossierByOwner(share.userId, share.projectId);
  return dossier ? { dossier, share } : null;
}

export function renderProjectDossierForAgent(dossier: ProjectDossier): string {
  const { detail, userProject, state } = dossier;
  const attrs = detail.attrs;
  const latest = [...(detail.devLog ?? [])].reverse()[0] ?? null;
  const resources = (detail.resources ?? [])
    .filter((r) => r.title?.trim() || r.url?.trim() || r.notes?.trim())
    .slice(0, 16);
  const goals = detail.linkedGoals.slice(0, 8);
  const recentRuns = dossier.runs.slice(0, 8);

  const lines: string[] = [
    renderOperatingPrinciples(),
    `# Project dossier: ${detail.project.name}`,
  ];

  // cleanDescription filters the bulk-import placeholder ("Local repository
  // imported from loki-ui") — feeding that to agents as the project
  // "Brief" was context poison, visible verbatim in every dispatched prompt.
  const description = cleanDescription(detail.project.description);
  if (description) lines.push(`Brief: ${description}`);

  const profile: Array<[string, string | undefined | null]> = [
    ["Mission", attrs.mission],
    ["Vision", attrs.vision],
    ["Customers", attrs.customers],
    ["Problem", attrs.problem],
    ["Solution", attrs.solution],
    ["Distribution", attrs.distribution],
    ["Go-to-market", attrs.gtm],
    ["Status", attrs.status],
    // Derived, traceable health — replaces the hand-typed attrs.maturity score.
    [
      "Health",
      describeProjectHealth(
        computeProjectHealth({
          description: detail.project.description,
          gitUrl: userProject?.gitUrl ?? detail.project.gitUrl,
          dirPath: userProject?.dirPath,
          liveUrl: userProject?.liveUrl,
          attrs,
        }),
      ),
    ],
    ["Stack", attrs.stack ?? userProject?.stack],
    ["Architecture", attrs.architecture],
    ["Conventions", attrs.conventions],
    ["Definition of done", attrs.definition_of_done],
    ["Next owner step", attrs.next_step],
    ["Operator notes", userProject?.notes],
  ];
  const filledProfile = profile.filter(([, value]) => value?.trim()) as Array<[string, string]>;
  if (filledProfile.length > 0) {
    lines.push("## Profile");
    for (const [label, value] of filledProfile) lines.push(`- ${label}: ${value}`);
  }

  if (state) {
    lines.push("## Runtime");
    lines.push(`- Agent running: ${state.agentRunning ? "yes" : "no"}`);
    if (state.sessionStatus) lines.push(`- Session status: ${state.sessionStatus}`);
    if (state.currentPromptLabel) lines.push(`- Current prompt: ${state.currentPromptLabel}`);
    if (state.sessionUpdatedAt)
      lines.push(`- Last handoff: ${state.sessionUpdatedAt.toISOString()}`);
  }

  if (latest) {
    lines.push("## Latest handoff");
    if (latest.done) lines.push(`- Done: ${latest.done}`);
    if (latest.next) lines.push(`- Next: ${latest.next}`);
    if (latest.tests) lines.push(`- Tests: ${latest.tests}`);
    if (latest.todos) lines.push(`- TODOs: ${latest.todos}`);
    if (latest.health) lines.push(`- Health: ${latest.health}`);
  }

  if (goals.length > 0) {
    lines.push("## Active roadmap");
    for (const goal of goals) {
      const milestones = Array.isArray(goal.milestones)
        ? goal.milestones
            .filter((m) => !m.done)
            .slice(0, 3)
            .map((m) => m.title)
            .join("; ")
        : "";
      lines.push(
        `- ${goal.title}${typeof goal.progress === "number" ? ` (${goal.progress}%)` : ""}${milestones ? ` — next: ${milestones}` : ""}`,
      );
    }
  }

  if (resources.length > 0) {
    lines.push("## Resources");
    for (const r of resources) {
      if (r.kind === "credential" || r.sensitivity === "credential" || r.sensitivity === "secret") {
        lines.push(
          `- ${r.title} (${r.sensitivity ?? r.kind} reference; do not expose secret values)${r.notes ? ` — ${r.notes}` : ""}`,
        );
      } else {
        const meta = [r.kind, r.visibility ?? "private", r.sensitivity ?? "normal", r.url, r.notes]
          .filter(Boolean)
          .join(" — ");
        lines.push(`- ${r.title}${meta ? ` (${meta})` : ""}`);
      }
    }
  }

  if (dossier.commits?.length) {
    lines.push("## Recent repo commits");
    for (const c of dossier.commits.slice(0, 8)) {
      lines.push(`- ${new Date(c.atMs).toISOString().slice(0, 10)} ${c.sha}: ${c.message}`);
    }
  }

  if (recentRuns.length > 0) {
    lines.push("## Recent run outcomes");
    for (const run of recentRuns) {
      lines.push(`- ${run.startedAt.toISOString()}: ${run.intent} — ${run.outcome ?? run.state}`);
    }
  }

  return lines.join("\n").slice(0, 9000);
}
