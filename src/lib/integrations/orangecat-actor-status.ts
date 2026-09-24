/**
 * OrangeCat → Loki: "what is happening to this person's projects?"
 *
 * OrangeCat's agent (Cat) could hand work to Loki — the build intent, the site
 * commission — and then never learn what became of it. This is the read that
 * closes the loop: OrangeCat signs `{ actorId, issuedAt }` on the shared
 * ORANGECAT_WEBHOOK_SECRET rail and gets back, for the Loki account that
 * signed in with that OrangeCat actor, each project's state, live site and
 * waiting feedback.
 *
 * The caller's side of the contract is orangecat
 * `src/services/loki/actor-status.ts`; change neither alone.
 *
 * Deliberately narrow: the fields OrangeCat's Cat acts on and nothing else —
 * no prompts, directories, tokens or agent internals cross the boundary.
 * Pure: the route does the queries, this shapes them, so it tests without a DB.
 */

import { APP_URL } from "@/config/brand";

/** OrangeCat rejects nothing older; Loki rejects anything older than this. */
export const ACTOR_STATUS_MAX_AGE_MS = 5 * 60 * 1000;
export const ACTOR_STATUS_MAX_PROJECTS = 25;
const MAX_OUTCOMES = 5;

export type ActorProjectState = "working" | "blocked" | "idle";

export interface ActorProjectStatus {
  id: string;
  name: string;
  lokiUrl: string;
  liveUrl: string | null;
  status: ActorProjectState;
  blockReason: string | null;
  queueDepth: number;
  currentWork: string | null;
  recentOutcomes: string[];
  feedback: { new: number; open: number };
  orangecat: Array<{ entityType: string; entityId: string }>;
}

/** The slices of the existing query results this needs — structural, so tests
 *  pass plain objects and the DB row types can grow without touching this. */
export interface ActorStatusInput {
  projects: Array<{
    id: string;
    name: string;
    liveUrl: string | null;
    entityProjectId: string | null;
  }>;
  states: Array<{
    projectKey: string;
    agentRunning: boolean | null;
    sessionStatus: string | null;
    sessionBlockReason: string | null;
    promptQueue: unknown[] | null;
    currentPromptLabel: string | null;
  }>;
  outcomes: Map<string, string[]>;
  feedback: Array<{ projectId: string; newCount: number; openCount: number }>;
  links: Array<{ projectId: string; entityType: string; entityId: string }>;
}

/** A request is fresh when issued within the window, in either direction (clock skew). */
export function isFreshIssuedAt(issuedAt: string, now: number = Date.now()): boolean {
  const t = Date.parse(issuedAt);
  return Number.isFinite(t) && Math.abs(now - t) <= ACTOR_STATUS_MAX_AGE_MS;
}

export function shapeActorStatus(input: ActorStatusInput): ActorProjectStatus[] {
  const stateByKey = new Map(input.states.map((s) => [s.projectKey.toLowerCase(), s]));
  // Feedback is keyed by the project's ENTITY id (site_feedback.project_id →
  // entities.id), which user_projects carries as entityProjectId.
  const feedbackByEntity = new Map(input.feedback.map((f) => [f.projectId, f]));

  return input.projects.slice(0, ACTOR_STATUS_MAX_PROJECTS).map((p) => {
    const s = stateByKey.get(p.name.toLowerCase());
    const blockReason = s?.sessionBlockReason ?? null;
    const status: ActorProjectState = blockReason
      ? "blocked"
      : s?.agentRunning || s?.sessionStatus === "working"
        ? "working"
        : "idle";
    const fb = p.entityProjectId ? feedbackByEntity.get(p.entityProjectId) : undefined;
    return {
      id: p.id,
      name: p.name,
      lokiUrl: `${APP_URL}/projects/${p.id}`,
      liveUrl: p.liveUrl && /^https?:\/\//i.test(p.liveUrl) ? p.liveUrl : null,
      status,
      blockReason,
      queueDepth: Array.isArray(s?.promptQueue) ? s.promptQueue.length : 0,
      currentWork: s?.currentPromptLabel ?? null,
      recentOutcomes: (input.outcomes.get(p.name) ?? []).slice(0, MAX_OUTCOMES),
      feedback: { new: fb?.newCount ?? 0, open: fb?.openCount ?? 0 },
      orangecat: input.links
        .filter((l) => l.projectId === p.id)
        .map((l) => ({ entityType: l.entityType, entityId: l.entityId })),
    };
  });
}
