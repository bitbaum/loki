import { DAY_MS } from "@/lib/constants/time";

/** Canonical goal status values — used across GoalCard, goals page, ProjectGoalsTab, API routes */
export const GOAL_STATUS = {
  ACTIVE: "active",
  COMPLETED: "completed",
  ABANDONED: "abandoned",
} as const;
export type GoalStatus = (typeof GOAL_STATUS)[keyof typeof GOAL_STATUS];

/** Canonical subscription status values — used in SubscriptionActions, money page, API routes */
export const SUB_STATUS = {
  ACTIVE: "active",
  UNVERIFIED: "unverified",
  CANCELLED: "cancelled",
} as const;
export type SubStatus = (typeof SUB_STATUS)[keyof typeof SUB_STATUS];

/** Canonical commitment status values — used in today queries, commitments API */
export const COMMITMENT_STATUS = {
  ACTIVE: "active",
  FULFILLED: "fulfilled",
} as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUS)[keyof typeof COMMITMENT_STATUS];

/**
 * Agent-reported session lifecycle status — the value an agent writes in its
 * `status:` handoff line, read by the auto-inject gate (dispatch-gates.ts) and
 * the session-state parser. SSOT so a rename cannot silently break the iron-rule
 * gate that keeps Loki from interrupting a working/blocked agent.
 * NOTE: distinct from project-STATE keys ("working"/"ready" chips) in
 * control-states.ts, which happen to share strings but mean a different thing.
 */
export const SESSION_STATUS = {
  READY: "ready", // agent finished its turn — safe to auto-continue
  WORKING: "working", // agent mid-turn — never interrupt
  BLOCKED: "blocked", // agent blocked on user/input — never interrupt
} as const;
export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

/**
 * Action workflow status values — IRON RULE: only 'approved' actions execute.
 * Flow: draft → approved → executed (or draft → rejected / expired)
 */
export const ACTION_STATUS = {
  DRAFT: "draft",
  APPROVED: "approved",
  EXECUTED: "executed",
  REJECTED: "rejected",
  EXPIRED: "expired",
} as const;
export type ActionStatus = (typeof ACTION_STATUS)[keyof typeof ACTION_STATUS];

/** Action type — what kind of action Loki is proposing. */
export const ACTION_TYPE = {
  SEND_MESSAGE: "send_message",
  SEND_EMAIL: "send_email",
  CREATE_EVENT: "create_event",
  CREATE_COMMITMENT: "create_commitment",
  FOLLOW_UP: "follow_up",
  /** Approve → injectPrompt a prepared prompt into a project (feedback digester). */
  DISPATCH_PROMPT: "dispatch_prompt",
  /** Accept a parsed contact into this user's private book. Never a scrape. */
  IMPORT_PERSON: "import_person",
  /** Accept a field proposal onto an existing person. Never silent. */
  ENRICH_PERSON: "enrich_person",
  /** Collapse two person rows that are the same human. Robots stay out. */
  MERGE_PEOPLE: "merge_people",
  OTHER: "other",
} as const;
export type ActionType = (typeof ACTION_TYPE)[keyof typeof ACTION_TYPE];

/**
 * Human assignment lifecycle — work handed to a person, not to an agent.
 *
 * The split that matters is WHO may move a row: the operator owns
 * draft/assigned/done/cancelled, the assignee owns accepted/declined/delivered
 * (they answer through a share link, never with an account). The legal moves
 * for each side live in config/crew.ts — this is only the vocabulary.
 *
 * `draft` is load-bearing: a proposed assignment, including one Loki wrote,
 * has told nobody anything. Handing it to a human is always the operator's
 * explicit act — the same IRON RULE the action queue runs on.
 */
export const HUMAN_TASK_STATUS = {
  DRAFT: "draft", // written down; nobody has been asked
  ASSIGNED: "assigned", // handed to a person, awaiting their answer
  ACCEPTED: "accepted", // they said yes and are on it
  DECLINED: "declined", // they said no — reassign or drop
  DELIVERED: "delivered", // they say it is done; you have not checked yet
  DONE: "done", // you accepted the work
  CANCELLED: "cancelled", // called off
} as const;
export type HumanTaskStatus = (typeof HUMAN_TASK_STATUS)[keyof typeof HUMAN_TASK_STATUS];

/** Event status values — used in events API, queries/events.ts, queries/today.ts */
export const EVENT_STATUS = {
  ACTIVE: "active",
  ARCHIVED: "archived",
} as const;
export type EventStatus = (typeof EVENT_STATUS)[keyof typeof EVENT_STATUS];

/**
 * Site-feedback inbox status — visitor feedback via the embeddable widget.
 * Nothing auto-dispatches; the operator triages.
 * Flow: new → dispatched → resolved, or new → archived.
 *
 * UI must NOT show the word "dispatched" as if work finished. Derive
 * FeedbackWorkView (lib/feedback/work-phase.ts): Not started / Queued /
 * Working now / Not running / Failed / Done.
 */
export const FEEDBACK_STATUS = {
  NEW: "new",
  DISPATCHED: "dispatched",
  RESOLVED: "resolved",
  ARCHIVED: "archived",
} as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUS)[keyof typeof FEEDBACK_STATUS];

/** What the visitor pointed the feedback widget at. */
export const FEEDBACK_SCOPE_VALUES = ["element", "page", "site"] as const;
export type FeedbackScope = (typeof FEEDBACK_SCOPE_VALUES)[number];

/**
 * PROJECT STAGE — where a project is in its life.
 *
 * This lived for months as the free-text attr `status`, rendered as a "Stage"
 * badge with a 13-key colour map. Nothing constrained it: two projects could
 * mean different things by "Development", and a value outside that map made
 * the badge silently VANISH rather than say anything. Every other vocabulary
 * in this product is declared in this file; stage simply never joined them,
 * which is why the page read as a hard-coded demo of a system that did not
 * exist.
 *
 * Ordered by life rather than alphabetically: the order IS the meaning, and a
 * picker built from it should read as a progression.
 *
 * `status` stays the storage key — renaming the attr would orphan every value
 * an agent has already written, and "Stage" is the word the operator has been
 * shown for a long time. The word people see is the one worth making true.
 */
export const PROJECT_STAGE = {
  IDEA: "idea",
  BLUEPRINT: "blueprint",
  DEVELOPMENT: "development",
  PRE_LAUNCH: "pre-launch",
  PRODUCTION: "production",
  PAUSED: "paused",
  ARCHIVED: "archived",
} as const;
export type ProjectStage = (typeof PROJECT_STAGE)[keyof typeof PROJECT_STAGE];

/** In life order, for pickers and anything rendering the whole set. */
export const PROJECT_STAGES: readonly ProjectStage[] = [
  PROJECT_STAGE.IDEA,
  PROJECT_STAGE.BLUEPRINT,
  PROJECT_STAGE.DEVELOPMENT,
  PROJECT_STAGE.PRE_LAUNCH,
  PROJECT_STAGE.PRODUCTION,
  PROJECT_STAGE.PAUSED,
  PROJECT_STAGE.ARCHIVED,
];

/**
 * What each stage MEANS. Shown in the picker, so the answer to "what counts as
 * pre-launch?" sits next to the choice instead of in someone's head.
 */
export const PROJECT_STAGE_MEANING: Record<ProjectStage, string> = {
  idea: "Written down, nothing built yet.",
  blueprint: "Scoped and planned; work has not started.",
  development: "Being built. Not usable by anyone else yet.",
  "pre-launch": "Usable and being readied — not announced.",
  production: "Live and in real use.",
  paused: "Deliberately stopped. Not abandoned.",
  archived: "Finished or dropped. Kept for the record.",
};

/**
 * Values written before the vocabulary existed, mapped to what they meant.
 *
 * Deliberately NOT a fuzzy normaliser: every entry is a value actually present
 * in the data. Anything unrecognised STAYS unrecognised, and the UI says so
 * out loud instead of hiding the badge — a project whose stage nobody can read
 * is a fact worth showing, not a blank.
 */
export const LEGACY_PROJECT_STAGE: Record<string, ProjectStage> = {
  active: PROJECT_STAGE.PRODUCTION,
  live: PROJECT_STAGE.PRODUCTION,
  launched: PROJECT_STAGE.PRODUCTION,
  prod: PROJECT_STAGE.PRODUCTION,
  planning: PROJECT_STAGE.BLUEPRINT,
  early: PROJECT_STAGE.DEVELOPMENT,
  "early stage": PROJECT_STAGE.DEVELOPMENT,
  "in-progress": PROJECT_STAGE.DEVELOPMENT,
  "in progress": PROJECT_STAGE.DEVELOPMENT,
  building: PROJECT_STAGE.DEVELOPMENT,
  deprecated: PROJECT_STAGE.ARCHIVED,
  retired: PROJECT_STAGE.ARCHIVED,
};

export function isProjectStage(value: unknown): value is ProjectStage {
  return typeof value === "string" && (PROJECT_STAGES as readonly string[]).includes(value);
}

/**
 * The stage a stored value means, or null when nothing can be said.
 *
 * Reads the FIRST clause only, because stored values are prose as often as
 * labels ("Production — payments live, shop pending"). Returning null is a
 * real answer, not a failure: the caller shows the raw text marked
 * unrecognised rather than pretending the field is empty.
 */
export function resolveProjectStage(raw: string | null | undefined): ProjectStage | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const head = (trimmed.split(/\s[—–-]\s|[,:([]/)[0] ?? trimmed).trim().toLowerCase();
  if (isProjectStage(head)) return head;
  return LEGACY_PROJECT_STAGE[head] ?? null;
}

/**
 * Who filed a feedback row: a real visitor (widget), the AI page reviewer, or
 * the inbox synthesizer (whose rows are aggregate BRIEFs, not reports —
 * the digester must not re-cluster them). Self-asserted via the public write
 * token, so treat as a routing hint, not a trust boundary; worst case a
 * visitor mislabels their own report.
 */
export const FEEDBACK_SOURCE_VALUES = ["visitor", "ai_review", "synthesizer"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCE_VALUES)[number];
export const FEEDBACK_SOURCE = {
  VISITOR: "visitor",
  AI_REVIEW: "ai_review",
  SYNTHESIZER: "synthesizer",
} as const satisfies Record<string, FeedbackSource>;

/**
 * Widget-token remote state. The embed's boot call gates rendering on ACTIVE,
 * so pausing takes effect on the customer site without any deploy.
 */
export const WIDGET_TOKEN_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
} as const;
export type WidgetTokenStatus = (typeof WIDGET_TOKEN_STATUS)[keyof typeof WIDGET_TOKEN_STATUS];

/**
 * Display tone for a status dot/badge — severity semantics shared by the
 * activity classifier (lib/activity-status.ts) and the dispatch live status
 * (lib/dispatch-status.ts). NOTE: distinct from EVENT_STATUS above, which is
 * the events-table lifecycle (active/archived) — this is how something LOOKS,
 * not what it IS.
 */
export type StatusTone = "negative" | "warning" | "positive" | "neutral";

/**
 * Builder channels — which builder executes a command: the hosted box-runner
 * ("cloud") or the desktop Fleet Runner ("local"). SSOT for the union that was
 * previously hand-declared at every transport boundary (pending-command
 * payloads, bridge fast-lane events, peek fanout, route validators). Array
 * form so route schemas can `z.enum(BUILDER_CHANNELS)` directly.
 */
export const BUILDER_CHANNELS = ["cloud", "local"] as const;
export type BuilderChannel = (typeof BUILDER_CHANNELS)[number];

/**
 * Narrow an untrusted value to a channel. Needed wherever a channel crosses a
 * boundary that TypeScript cannot vouch for — a JSON response body, or
 * persisted message metadata replayed months after it was written. An unknown
 * string would otherwise index the copy map to `undefined` and silently drop
 * the builder's name from the label.
 */
/**
 * The third stored preference: the HOSTED runner. Not a channel — nothing
 * claims it from a PTY queue — but a routing decision a project can pin:
 * every dispatch goes straight to the hosted runner (Hermes in its own clone,
 * on whichever providers the box holds keys for). It is the unattended path
 * that needs no Claude credential at all, which is why it exists: on
 * 2026-09-14 the box's Claude Code token died with the account that minted
 * it and every self-dispatch hung, while Hermes on the same box answered fine.
 */
export const HOSTED_BUILDER_PREF = "hosted" as const;
/** `user_projects.builder_pref` accepts a channel or the hosted runner. */
export const BUILDER_PREFS = [...BUILDER_CHANNELS, HOSTED_BUILDER_PREF] as const;
export type BuilderPref = (typeof BUILDER_PREFS)[number];
export function isHostedBuilderPref(value: unknown): value is typeof HOSTED_BUILDER_PREF {
  return value === HOSTED_BUILDER_PREF;
}

export function isBuilderChannel(value: unknown): value is BuilderChannel {
  return typeof value === "string" && (BUILDER_CHANNELS as readonly string[]).includes(value);
}

/**
 * The tier a project runs on when its row says nothing: the always-on box.
 *
 * Local is a stored, per-project decision (`user_projects.builder_pref`), never
 * a guess from which runner happens to be connected. Guessing from presence is
 * how a dispatch sent from a phone landed on a laptop nobody was watching and
 * died when the lid shut, and how a repo-only project was pinned to a laptop
 * that then hunted for a zellij tab that could not exist. `pickDispatchChannel`
 * is the one rule: locus lock → stored preference → this floor.
 */
export const DEFAULT_BUILDER_CHANNEL: BuilderChannel = "cloud";

/** Entity type values — used in people queries, projects queries, and API routes.
 *  `robot` is an actor (see src/config/actors.ts). Humans and robots share the
 *  entities table; capability (check-in vs market) is decided by that SSOT,
 *  never by a parallel robots table. */
export const ENTITY_TYPE = {
  PERSON: "person",
  ROBOT: "robot",
  PROJECT: "project",
  COMPANY: "company",
  GOAL: "goal",
  TOOL: "tool",
  CONCEPT: "concept",
  EVENT: "event",
} as const;
export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];

/** Habit frequency values */
export const HABIT_FREQUENCY = {
  DAILY: "daily",
  WEEKDAYS: "weekdays",
  WEEKLY: "weekly",
} as const;
export type HabitFrequency = (typeof HABIT_FREQUENCY)[keyof typeof HABIT_FREQUENCY];

/** Returns true if a habit with the given frequency is due on the given day-of-week (0=Sun…6=Sat). */
export function isHabitScheduled(frequency: HabitFrequency, dow: number): boolean {
  if (frequency === HABIT_FREQUENCY.WEEKDAYS) return dow >= 1 && dow <= 5;
  if (frequency === HABIT_FREQUENCY.WEEKLY) return dow === 1;
  return true;
}

/** Count how many days in the last `days` calendar days a habit of the given frequency was scheduled. */
export function scheduledDays(frequency: HabitFrequency, days: number): number {
  let count = 0;
  for (let i = 0; i < days; i++) {
    const dow = new Date(Date.now() - i * DAY_MS).getDay();
    if (isHabitScheduled(frequency, dow)) count++;
  }
  return Math.max(1, count);
}

/** Interaction direction — inbound = they reached out, outbound = we did */
export const INTERACTION_DIRECTION = {
  INBOUND: "inbound",
  OUTBOUND: "outbound",
} as const;
export type InteractionDirection =
  (typeof INTERACTION_DIRECTION)[keyof typeof INTERACTION_DIRECTION];

/** People-list sort modes — shared between the API parser, the UI cycle
 *  button, and the queries layer. Lives here (not in queries/people.ts)
 *  so client components can import the values without dragging in the
 *  server-only db module. */
export const SORT_MODE = {
  RECENT: "recent",
  NAME: "name",
  HEALTH: "health",
} as const;
export type SortMode = (typeof SORT_MODE)[keyof typeof SORT_MODE];
export const SORT_LABELS: Record<SortMode, string> = {
  [SORT_MODE.RECENT]: "Recent",
  [SORT_MODE.NAME]: "A–Z",
  [SORT_MODE.HEALTH]: "Needs attention",
};

/** Alert severity values */
export const ALERT_SEVERITY = {
  INFO: "info",
  WARNING: "warning",
  URGENT: "urgent",
} as const;
