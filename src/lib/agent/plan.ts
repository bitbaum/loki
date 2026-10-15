/**
 * The retrieval planner — which sources a turn reads, and in what order.
 *
 * Pure: a message in, a plan out. No database, no model. This is the decision
 * that used to be made by the model inside the tool loop ("which tool do I
 * call?"), and it moved here for one reason: the loop needs a healthy model
 * AND a prompt that fits a per-minute window before it can ask a single
 * question, and in production it had neither — every turn shipped zero facts
 * and the model was asked to reason about an empty page. A keyword planner is
 * dumber than a model and it is never rate-limited. It answers the cheap
 * question ("is this about feedback?") so the model can spend its one call on
 * the expensive one ("what does this feedback mean for the operator?").
 *
 * Cat (OrangeCat's assistant, which the operator considers good) works this
 * way: fifteen sources fetched in parallel before the model is called, tools
 * only as enrichment behind a keyword pre-filter. Loki now does the same.
 *
 * Ordering is the second half of the job. The fact set is head-sliced when it
 * has to shrink, so the FIRST source in the plan is the one the operator asked
 * about, and the always-on background (projects, the fleet pulse) comes last.
 */
import {
  APPROVAL_CUES,
  BUILD_CUES,
  CAPTURE_CUES,
  COMMITMENT_CUES,
  CREW_CUES,
  ECONOMY_CUES,
  FEEDBACK_CUES,
  GOAL_CUES,
  HABIT_CUES,
  KNOWLEDGE_CUES,
  OPS_CUES,
  PEOPLE_CUES,
  PLANNING_CUES,
  PROJECT_CUES,
  RECENCY_CUES,
  RUN_CUES,
  WEBSITE_CUES,
  USAGE_CUES,
  FLEET_MAP_CUES,
  THREAD_CUES,
} from "@/lib/agent/cues";

/** Every source the seed builder knows how to fetch. */
export const SOURCE_IDS = [
  "feedback",
  "runs",
  "sessions",
  "alerts",
  "fleet_status",
  "approvals",
  "goals",
  "habits",
  "commitments",
  "crew",
  "human_tasks",
  "captures",
  "people",
  "knowledge",
  "economy",
  "builds",
  "usage",
  "projects",
  "fleet_map",
  "threads",
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export type RetrievalPlan = {
  /** Sources to fetch, leading subject first. Never empty. */
  sources: SourceId[];
  /** True when no cue matched — a broad, shallow sample is fetched instead. */
  broad: boolean;
  /** "Most recent X" shape: short lists, newest first. */
  recency: boolean;
  /** The computed daily brief (goals stuck, due soon, habits at risk) is wanted. */
  brief: boolean;
  /** The computed fleet brief (runs waiting/errored, unread feedback, runner) is wanted. */
  fleetBrief: boolean;
};

/**
 * Per-source limits. Two sizes: the leading subject gets depth, background
 * sources get a glance. Numbers are small on purpose — the prompt has to fit
 * a free-tier per-minute window on the first vendor in the chain, and every
 * record past the one the operator asked about is a record the small model
 * may answer about instead.
 */
export const SOURCE_LIMITS: Record<SourceId, { lead: number; background: number }> = {
  feedback: { lead: 8, background: 3 },
  runs: { lead: 10, background: 4 },
  sessions: { lead: 8, background: 4 },
  alerts: { lead: 8, background: 3 },
  fleet_status: { lead: 1, background: 1 },
  approvals: { lead: 8, background: 3 },
  goals: { lead: 12, background: 4 },
  habits: { lead: 12, background: 4 },
  commitments: { lead: 12, background: 4 },
  crew: { lead: 12, background: 4 },
  human_tasks: { lead: 12, background: 4 },
  captures: { lead: 10, background: 3 },
  people: { lead: 12, background: 4 },
  knowledge: { lead: 6, background: 2 },
  economy: { lead: 3, background: 0 },
  // Already ranked and varied server-side; six is the row the start screen shows.
  builds: { lead: 6, background: 0 },
  // One fact per surface Loki records use of (src/config/usage-surfaces.ts).
  usage: { lead: 4, background: 1 },
  // A question ABOUT projects gets the whole fleet ("how many projects am I
  // tracking" must not be answered from a sample). A question about anything
  // else gets a glance: measured live, 38 project facts were the bulk of a
  // 12912-token prompt on a question about FEEDBACK, which put the turn past
  // every Groq window and forced it onto a vendor whose daily quota was spent.
  // Background context that crowds out the subject is not context, it is cost.
  projects: { lead: 40, background: 10 },
  // One fact: the whole studio map as one overview block (lead only).
  fleet_map: { lead: 1, background: 0 },
  // The operator's own recent chats — only when they ask about them.
  threads: { lead: 12, background: 0 },
};

/**
 * Sources always worth a glance, in the order they should trail the subject.
 * Projects last: it is the largest block and the least often the point.
 */
const BACKGROUND: SourceId[] = ["fleet_status", "projects"];

/** The broad sample used when no cue matched — a little of each hot surface. */
const BROAD_SAMPLE: SourceId[] = [
  "people",
  "fleet_status",
  "runs",
  "feedback",
  "approvals",
  "knowledge",
  "projects",
];

export function planRetrieval(message: string): RetrievalPlan {
  const m = message.trim();
  const lead: SourceId[] = [];
  const push = (id: SourceId) => {
    if (!lead.includes(id)) lead.push(id);
  };

  // The order of these tests IS the precedence, and it runs from the most
  // specifically NAMED surface to the most general. A question that says
  // "goal" is a goal question even when it also says "stuck", and "stuck" is
  // a run word — testing runs first made "which goal is stuck at 0%" lead with
  // runs and shed the goals to the tail. Named noun beats shared adjective.
  // Asked for direction: the ranked suggestions lead, because they already
  // fold in feedback, dev-log next steps, goals, notes and demand.
  // Asked about USE ("how am I using Build next"), usage leads — tested first,
  // because "build next" is also a build cue. A build recommendation is in
  // turn informed by what the person actually taps, so usage trails the
  // suggestions whenever they lead.
  // "What did I ask you" names the conversations themselves — the most
  // specific subject there is, so it leads; runs follow to say what happened.
  if (THREAD_CUES.test(m)) {
    push("threads");
    push("runs");
  }
  if (USAGE_CUES.test(m)) push("usage");
  if (BUILD_CUES.test(m)) {
    push("builds");
    push("usage");
  }
  if (FEEDBACK_CUES.test(m)) push("feedback");
  if (APPROVAL_CUES.test(m)) push("approvals");
  if (GOAL_CUES.test(m)) push("goals");
  if (HABIT_CUES.test(m)) push("habits");
  if (COMMITMENT_CUES.test(m)) push("commitments");
  if (CREW_CUES.test(m)) {
    push("crew");
    push("human_tasks");
  }
  if (CAPTURE_CUES.test(m)) push("captures");
  if (RUN_CUES.test(m)) {
    push("runs");
    push("sessions");
  }
  if (OPS_CUES.test(m)) {
    push("fleet_status");
    push("alerts");
    push("runs");
    push("sessions");
    push("feedback");
    push("approvals");
  }
  if (WEBSITE_CUES.test(m)) push("projects");
  if (PEOPLE_CUES.test(m)) push("people");
  if (ECONOMY_CUES.test(m)) push("economy");
  // The studio map leads any fleet-shaped question, before the per-project
  // rows: the shape of the whole is the answer, the rows are the detail. Tested
  // before KNOWLEDGE: "what is loki for" is a map question, not an essay hunt.
  if (FLEET_MAP_CUES.test(m)) {
    push("fleet_map");
    push("projects");
  }
  if (KNOWLEDGE_CUES.test(m)) push("knowledge");
  if (PROJECT_CUES.test(m)) push("projects");

  const planning = PLANNING_CUES.test(m);
  const ops = OPS_CUES.test(m);
  if (planning) {
    push("goals");
    push("commitments");
    push("habits");
    push("approvals");
  }

  const broad = lead.length === 0;
  const sources = broad ? [...BROAD_SAMPLE] : [...lead];
  for (const id of BACKGROUND) if (!sources.includes(id)) sources.push(id);

  return {
    sources,
    broad,
    recency: RECENCY_CUES.test(m),
    brief: planning,
    fleetBrief: ops || planning || FEEDBACK_CUES.test(m) || RUN_CUES.test(m),
  };
}

/**
 * Which tools are worth SHOWING for a given plan.
 *
 * ── WHY SHOW FEWER THAN WE ACCEPT ────────────────────────────────────────────
 *
 * The tool catalogue plus its native JSON schema measure 3,010 tokens, charged
 * on every turn before a single record. That is 47% of a measured 6,442-token
 * feedback turn, and it is why Groq — whose window is 8,000 tokens per minute —
 * is skipped on every call and never used at all.
 *
 * Cutting RECORDS to fit would recreate the exact failure this retrieval layer
 * was built to end. The catalogue is the cheap half: it carries no facts.
 *
 * ── THIS REMOVES NO CAPABILITY ───────────────────────────────────────────────
 *
 * Only what the model is SHOWN narrows. The parser's accepted-name set stays
 * the whole registry and the executor still holds every handler, so a model
 * that names an unadvertised tool still runs it. And the tools for whatever the
 * planner identified are always present, alongside a core that answers "what
 * else is there".
 *
 * Measured before doing it: across five representative questions on production,
 * ZERO turns called a tool. The seed answered all of them. So this is 1,100 to
 * 1,700 tokens per turn bought back from capability that, in practice, no turn
 * was spending.
 */
const TOOLS_FOR_SOURCE: Record<SourceId, readonly string[]> = {
  feedback: ["list_feedback"],
  runs: ["list_runs", "list_active_agents"],
  sessions: ["list_active_agents"],
  alerts: ["list_alerts"],
  fleet_status: ["fleet_status"],
  approvals: ["list_pending_approvals"],
  goals: ["list_goals"],
  habits: ["list_habits"],
  commitments: ["list_commitments"],
  crew: ["list_crew"],
  human_tasks: ["list_human_tasks", "propose_human_task"],
  captures: ["list_notes"],
  people: ["search_people", "propose_action"],
  knowledge: ["search_knowledge"],
  economy: [],
  builds: ["suggest_builds"],
  // A computed tally; Loki reads it as a seed fact, no tool needed.
  usage: [],
  projects: ["list_projects"],
  // The map is a computed view (register + profiles + runs); no tool reads it.
  fleet_map: [],
  // Read as seed facts when asked about; no tool reads other threads.
  threads: [],
};

/**
 * Always offered, whatever the question.
 *
 * The pulse and the project list answer "what else is going on"; the knowledge
 * index answers "why did we decide that"; the approval queue is the one lever
 * Loki has on the world and must never be hidden from it.
 */
const CORE_TOOLS: readonly string[] = [
  "read_website",
  "fleet_status",
  "list_projects",
  "search_knowledge",
  "propose_action",
];

/** Tool names worth advertising for this plan. A broad plan gets everything. */
export function toolsForPlan(plan: RetrievalPlan): Set<string> {
  const wanted = new Set(CORE_TOOLS);
  // A question nobody could route is a question that might need anything.
  if (plan.broad) return new Set<string>();
  for (const source of plan.sources) {
    for (const name of TOOLS_FOR_SOURCE[source] ?? []) wanted.add(name);
  }
  return wanted;
}

/** The limit a source gets under this plan: depth for the subject, a glance otherwise. */
export function sourceLimit(plan: RetrievalPlan, id: SourceId): number {
  const limits = SOURCE_LIMITS[id];
  const leadCount = plan.broad ? 0 : plan.sources.indexOf(id) < 2 ? 1 : 0;
  const n = leadCount ? limits.lead : limits.background;
  // "Most recent" wants the newest few, not a page of history.
  return plan.recency && id !== "projects" ? Math.min(n, 5) : n;
}
