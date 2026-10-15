/**
 * Turn cues — pure predicates deciding which context a turn earns.
 *
 * Kept apart from the data layer so the policy can be tested without a
 * database. Every cue is matched loosely on purpose, because the two errors
 * are not symmetric: a false positive costs a few hundred tokens of records
 * the model ignores; a false negative costs a confident wrong answer about the
 * operator's own data. Production served the false negative on 2026-08-14
 * (approvals) and again on 2026-09-11 (feedback), and both times the answer
 * — "Not in your data." — was indistinguishable from a checked one.
 *
 * Several independent words per cue rather than one canonical term, so the
 * question survives any single one being missing or misspelled ("what is
 * pening for approval" is a real transcript line).
 */

/** Planning/triage turns, when the computed daily brief earns its tokens. */
export const PLANNING_CUES =
  /\b(plan|today|day|urgent|priorit|attention|focus|stuck|due|deadline|overdue|next|habit|commit|risk|blocked|first)\b/i;

/** Turns about the approval queue. */
export const APPROVAL_CUES =
  /\b(approv|pending|queue|waiting|await|sign[- ]?off|authoriz|authoris|decide|decision|draft|reject)\w*/i;

/** Visitor feedback — the widget, reports, suggestions, bug reports. */
export const FEEDBACK_CUES =
  /\b(feedback|feed back|report(?:ed|s)?|suggestion|widget|visitor|complain|bug report|inbox|filed|submitted|sent in)\w*/i;

/** Agent runs and dispatches — did it run, finish, fail, what is waiting. */
export const RUN_CUES =
  /\b(run|runs|ran|running|dispatch|finish|finished|complet|fail|failed|failing|error|errored|crash|stuck|blocked|hang|hung|timeout|timed out|waiting|queued|working on|implement|autopilot|agent|agents|session|sessions|claude|codex|hermes)\w*/i;

/** The fleet as a whole — status, health, what needs the operator. */
export const OPS_CUES =
  /\b(fleet|status|health|healthy|needs? me|need my|what'?s (?:up|new|happening|going on)|overview|summary|pulse|runner|offline|online|alert|alerts|budget|tokens|quota|rate.?limit|check on|anything (?:wrong|broken)|everything ok|how are things)\b/i;

/** Goals, progress, targets. */
export const GOAL_CUES = /\b(goal|goals|milestone|progress|target|objective|okr|roadmap)\w*/i;

/** Habits and streaks. */
export const HABIT_CUES = /\b(habit|habits|streak|routine|daily|check(?:ed)? off)\w*/i;

/** Commitments, deadlines, calendar-shaped things. */
export const COMMITMENT_CUES =
  /\b(commit|commitment|deadline|due|event|events|meeting|calendar|appointment|promise|owe|schedule)\w*/i;

/** People and outreach. */
export const PEOPLE_CUES =
  /\b(who|contact|contacts|person|people|reach|email|message|call|phone|whatsapp|telegram|intro|introduce|met|do i know|do we know|do you know|know anyone|know someone|know somebody|people i know)\b/i;

/**
 * The crew and delegated work.
 *
 * "owe" is here AND in COMMITMENT_CUES on purpose. "Who owes me what" has two
 * true answers in this product — a commitment someone made, and an assignment
 * someone accepted — and the words cannot tell them apart. Both are retrieved.
 */
export const CREW_CUES =
  /\b(crew|delegat|assign|assignment|assignee|team|hand(?:ed)? (?:over|off)|task|tasks|human|owe|owes|owed)\w*/i;

/** Sticky notes and things the operator asked to remember. */
export const CAPTURE_CUES =
  /\b(note|notes|noted|remember|remind|jot|capture|captured|wrote down|save[ds]?)\b/i;

/** Knowledge, decisions, docs — the semantic index. */
export const KNOWLEDGE_CUES =
  /\b(why|how does|how do|decide|decided|decision|doc|docs|readme|architecture|design|explain|what is|what's the|remember when|history|wrote)\b/i;

/**
 * The outside economy — OrangeCat's open demand and matching listings: what
 * the fleet could BUILD FOR, and who is asking for it.
 *
 * The one source here that is not the operator's own data, so it is asked for
 * rather than always on. It was previously fetched on every fallback turn and
 * never on a primary one, which is the worst of both: it cost tokens where it
 * was rarely relevant and was missing where it was.
 */
export const ECONOMY_CUES =
  /\b(demand|need(?:s|ed)?|opportunit|market|client|customer|lead|leads|sell|sale|revenue|money|earn|paid|build for|who wants|looking for|orangecat)\w*/i;

/**
 * "What should I build?" — the operator asking for direction, not for a
 * record. Answered from the ranked build suggestions (src/lib/build-suggestions)
 * so Loki proposes from what is actually there instead of brainstorming.
 */
export const BUILD_CUES =
  /\b(what (?:should|could|can|shall) (?:i|we) (?:build|make|ship|work on|do next|start)|what to build|what (?:should|shall) (?:i|we) do next|any ideas?|ideas? for|what do you suggest|suggest (?:something|what|a build)|where (?:do|should) (?:i|we) start|build (?:something|next)|next build)\b/i;

/**
 * How the operator USES a surface Loki built — shown vs tapped, what they
 * ignore. Answered from operator_usage_events, never from the model's guess
 * about what people usually click.
 */
export const USAGE_CUES =
  /\b(how (?:am i|do i|have i been|often do i) us(?:e|ing)|do i (?:ever |actually )?(?:use|tap|click|open)|am i using|usage|used it|tapped|clicked|(?:i|we) (?:keep |always |just )?ignor(?:e|ed|ing)|never (?:use|tap|touch)|which (?:chips?|suggestions?|ideas?) do i)\b/i;

/** Projects by name or in aggregate. */
/**
 * The studio as a whole: what exists, which pillars, what is live, what is
 * being worked on. Answered from the fleet MAP as one deterministic fact, not
 * from whichever chunk wins a similarity race — on 2026-09-14 "what projects do
 * we have, name the three pillars" retrieved an essay and answered "Blog,
 * Roadmap, Changelog".
 */
export const FLEET_MAP_CUES =
  /\b(what (?:do|did) we have|what (?:are|is) (?:our|the) (?:projects?|products?|pillars?|studio|fleet|portfolio|ventures?)|which (?:projects?|products?|sites?|apps?) (?:are|is) live|pillars?|the studio|bitbaum|portfolio|ventures?|all (?:our |the )?projects|every project|how many projects|what is happening|what'?s happening|what is loki for|what is orangecat for|what is solon for)\b/i;

/** Website review language is a project topic, even when it contains "let me know". */
export const WEBSITE_CUES = /\b(website|webpage|homepage|codebase|source code)\w*/i;

export const PROJECT_CUES =
  /\b(project|projects|repo|repos|repository|app|apps|site|sites|stack|codebase|code|website|webpage|homepage|product|products)\w*/i;

/**
 * Words that mark "most recent / latest / last" — the shape of question where
 * the ORDER of records is the answer. Used by the planner to put the newest
 * record of the leading source first and to keep the list short.
 */
export const RECENCY_CUES =
  /\b(recent|recently|latest|last|newest|just|today|this morning|tonight)\b/i;

/**
 * The operator asking about their own conversations with Loki — what they
 * asked, what was said, where things were left. Answered from their recent
 * threads (sources-threads.ts); without these, "what did I ask you today?"
 * was answered from runs alone and reported no record of any request.
 */
export const THREAD_CUES =
  /\b(what (?:did|have) i (?:ask|asked|say|said|tell|told|send|sent)|i (?:asked|told) you|you (?:said|told me)|we (?:talked|discussed|spoke|chatted)|our (?:chats?|conversations?|threads?)|my (?:chats|threads|conversations)|other (?:chats?|threads?|conversations?)|catch me up|recap|where (?:were|was|did) (?:we|i) (?:leave|left|stop)|left off|what was i (?:doing|working on))\b/i;
