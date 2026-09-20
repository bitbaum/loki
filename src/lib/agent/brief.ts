/**
 * The deterministic brief — computed answers Loki must not derive itself.
 *
 * The failure that motivated this: asked "which goals are stuck at 0% for 30+
 * days, what's due in the next 3 days, which habit am I most at risk of
 * breaking", Loki answered all three from a context block that contained none
 * of that data. It had projects and RAG chunks; it had no goals-with-dates, no
 * commitments, no habits, no events. So it produced plausible items.
 *
 * The striking part is that Loki could already answer every one of those
 * questions EXACTLY — `getStuckGoals`, `getGoalsDueSoon`, `listUpcomingCommitments`,
 * `getEventsDueSoon` and `getTodayHabits` have existed for months. They were
 * simply never wired into the assistant. The model was asked to guess at
 * something the database knew.
 *
 * So: these are SQL predicates with exact answers, not judgment calls. Computing
 * them and handing the model a settled result strictly dominates injecting raw
 * rows and hoping it filters correctly — a language model can only add error to
 * a `WHERE progress = 0 AND updated_at < now() - 30d`. The model's remaining job
 * is to PHRASE and PRIORITISE, which is genuinely what it is good at.
 *
 * An empty result is a real answer ("nothing is due") and is rendered as such —
 * distinguishable from the query never having run, which is the distinction the
 * old context could not express.
 */
import { getStuckGoals, getGoalsDueSoon, listUpcomingCommitments } from "@/db/queries/today";
import { getEventsDueSoon } from "@/db/queries/events";
import { isOverdue, toLocalDateStr } from "@/lib/dates";
import { getTodayHabits } from "@/db/queries/habits";
import type { Directive } from "@bitbaum/ai-kit/grounding";

/** Days ahead treated as "imminent" for the day-planning brief. */
const IMMINENT_DAYS = 3;
/** Progress-at-zero staleness window, matching getStuckGoals' own default. */
const STUCK_DAYS = 30;

/** YYYY-MM-DD, through the same helper `isOverdue` compares against. It used to
 *  be `toISOString().slice(0,10)` — a UTC day next to a word decided on the
 *  local one, which disagree for part of every day and would print "due" beside
 *  yesterday's date (or the reverse) depending only on where the process runs. */
function dateLabel(d: Date | string | null): string {
  if (!d) return "no date";
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "no date" : toLocalDateStr(date);
}

/**
 * Build the computed half of Loki's context.
 *
 * Every branch is best-effort: a failing query yields a directive whose answer
 * is empty and whose method says it failed, rather than being dropped. A
 * silently missing directive is indistinguishable from "nothing matched", and
 * that ambiguity is what lets a model fill the gap — so failure is stated.
 */
export async function buildDailyBrief(userId: string): Promise<Directive[]> {
  const [stuck, goalsDue, commitments, events, habits] = await Promise.all([
    getStuckGoals(userId, STUCK_DAYS).catch(() => null),
    getGoalsDueSoon(userId, IMMINENT_DAYS).catch(() => null),
    listUpcomingCommitments(userId, IMMINENT_DAYS).catch(() => null),
    getEventsDueSoon(userId, IMMINENT_DAYS).catch(() => null),
    getTodayHabits(userId).catch(() => null),
  ]);

  const directives: Directive[] = [];

  directives.push(
    stuck === null
      ? {
          question: `goals stuck at 0% for ${STUCK_DAYS}+ days`,
          answer: [],
          method: "QUERY FAILED — treat as unknown, not as none",
        }
      : {
          question: `goals stuck at 0% for ${STUCK_DAYS}+ days`,
          method: `SQL: status=active AND progress=0 AND updated_at < now()-${STUCK_DAYS}d`,
          answer: stuck.map(
            (g) =>
              `${g.title}${g.entityName ? ` (${g.entityName})` : ""} — untouched since ${dateLabel(g.updatedAt)}`,
          ),
        },
  );

  directives.push(
    goalsDue === null
      ? {
          question: `goals with a target date inside ${IMMINENT_DAYS} days, or already past`,
          answer: [],
          method: "QUERY FAILED — treat as unknown, not as none",
        }
      : {
          question: `goals with a target date inside ${IMMINENT_DAYS} days, or already past`,
          method: `SQL: status=active AND target_date <= now()+${IMMINENT_DAYS}d (no floor — past targets are IN scope)`,
          answer: goalsDue.map(
            (g) =>
              `${g.title} — ${isOverdue(g.targetDate) ? "target passed" : "due"} ${dateLabel(g.targetDate)}, ${g.progress ?? 0}% done`,
          ),
        },
  );

  directives.push(
    commitments === null
      ? {
          question: `commitments due inside ${IMMINENT_DAYS} days, or already overdue`,
          answer: [],
          method: "QUERY FAILED — treat as unknown, not as none",
        }
      : {
          question: `commitments due inside ${IMMINENT_DAYS} days, or already overdue`,
          method: `SQL: status=active AND due_date <= now()+${IMMINENT_DAYS}d (no floor — overdue rows are IN scope), nearest deadline first`,
          answer: commitments.map(
            (c) =>
              `${c.description} — ${isOverdue(c.dueDate) ? "was due" : "due"} ${dateLabel(c.dueDate)}`,
          ),
        },
  );

  directives.push(
    events === null
      ? {
          question: `events/deadlines inside ${IMMINENT_DAYS} days, or already past`,
          answer: [],
          method: "QUERY FAILED — treat as unknown, not as none",
        }
      : {
          question: `events/deadlines inside ${IMMINENT_DAYS} days, or already past`,
          method: `SQL: status=active AND deadline <= now()+${IMMINENT_DAYS}d (no floor — passed deadlines are IN scope)`,
          answer: events.map(
            (e) =>
              `${e.name} (${e.type}) — ${isOverdue(e.deadline) ? "deadline passed" : "deadline"} ${dateLabel(e.deadline)}`,
          ),
        },
  );

  // "Most at risk of breaking today" has an exact reading: not yet done today,
  // ordered by how much streak is on the line. Ties are broken by streak length
  // because a longer streak is a larger loss — that is a product decision, and
  // it belongs here in code where it is inspectable, not in a prompt where the
  // model re-invents it differently every turn.
  directives.push(
    habits === null
      ? {
          question: "habit most at risk today",
          answer: [],
          method: "QUERY FAILED — treat as unknown, not as none",
        }
      : {
          question: "habit most at risk today",
          method: "not yet checked off today, ranked by streak at stake (longest first)",
          answer: habits
            .filter((h) => !h.doneToday)
            .sort((a, b) => b.streak - a.streak)
            .slice(0, 3)
            .map((h) => `${h.title} — ${h.streak}-day streak at stake, not yet done today`),
        },
  );

  return directives;
}

/**
 * The fleet half of the brief — computed answers about what the AGENTS did,
 * for "what needs me?" and every question that mentions runs or feedback.
 *
 * Same principle as the daily brief above: these are SQL predicates with exact
 * answers ("7 runs are waiting, the oldest since 06:25"), and a model handed
 * raw rows will miscount them. Each directive says how it was computed, and a
 * failed query says it failed rather than reading as "none".
 *
 * Why it exists: on 2026-09-11 the operator's feedback spawned four runs that
 * sat in `waiting` for an hour while the runner reported connected, and no
 * surface said so. The fleet pulse is the one place that adds up.
 */
export async function buildFleetBrief(userId: string): Promise<Directive[]> {
  const [
    { listRecentRuns, countRunsByStateSince },
    { listUserFeedback },
    { getRunnerConnected },
    { getPendingActions },
    { getActiveAlerts },
    { ORCH_STATE },
    { FEEDBACK_STATUS },
    { DAY_MS },
    { timeLabel, agoLabel, excerpt },
  ] = await Promise.all([
    import("@/db/queries/orchestration-runs"),
    import("@/db/queries/site-feedback"),
    import("@/db/queries/runner-presence"),
    import("@/db/queries/actions"),
    import("@/db/queries/alerts"),
    import("@/lib/orchestration/contract"),
    import("@/lib/constants/statuses"),
    import("@/lib/constants/time"),
    import("@/lib/agent/fact-utils"),
  ]);

  const [waiting, errored, byState, feedback, runner, approvals, alerts] = await Promise.all([
    listRecentRuns(userId, { states: [ORCH_STATE.WAITING], limit: 20 }).catch(() => null),
    listRecentRuns(userId, { states: [ORCH_STATE.ERROR], limit: 10, sinceMs: DAY_MS }).catch(
      () => null,
    ),
    countRunsByStateSince(userId, DAY_MS).catch(() => null),
    listUserFeedback(userId, 50).catch(() => null),
    getRunnerConnected(userId).catch(() => null),
    getPendingActions(userId).catch(() => null),
    getActiveAlerts(userId).catch(() => null),
  ]);

  const failed = (question: string): Directive => ({
    question,
    answer: [],
    method: "QUERY FAILED — treat as unknown, not as none",
  });
  const directives: Directive[] = [];

  directives.push(
    runner === null
      ? failed("is the runner connected")
      : {
          question: "is the runner connected",
          method: "runner_presence.connected for this operator",
          answer: [runner ? "yes — connected" : "NO — offline; dispatched runs cannot start"],
        },
  );

  directives.push(
    waiting === null
      ? failed("runs waiting for a runner to pick them up")
      : {
          question: "runs waiting for a runner to pick them up",
          method: "SQL: orchestration_runs.state = 'waiting', newest first",
          answer: waiting.map(
            (r) =>
              `${r.projectKey} (${r.intent}) — waiting since ${timeLabel(r.startedAt)}, ${agoLabel(r.startedAt)}`,
          ),
        },
  );

  directives.push(
    errored === null
      ? failed("runs that errored in the last 24 hours")
      : {
          question: "runs that errored in the last 24 hours",
          method: "SQL: state = 'error' AND started_at > now() - 24h",
          answer: errored.map(
            (r) =>
              `${r.projectKey} (${r.intent}) — ${excerpt(r.error, 120) ?? "no error text recorded"}, ${agoLabel(r.startedAt)}`,
          ),
        },
  );

  directives.push(
    byState === null
      ? failed("runs started in the last 24 hours, by state")
      : {
          question: "runs started in the last 24 hours, by state",
          method: "SQL: count(*) GROUP BY state WHERE started_at > now() - 24h",
          answer: Object.entries(byState).map(([state, n]) => `${n} ${state}`),
        },
  );

  directives.push(
    feedback === null
      ? failed("the most recent visitor feedback")
      : {
          question: "the most recent visitor feedback",
          method: "SQL: site_feedback ORDER BY created_at DESC LIMIT 3 (visitor-written, quoted)",
          answer: feedback
            .slice(0, 3)
            .map(
              (f) =>
                `${f.projectName} · ${f.status} · filed ${timeLabel(f.createdAt)} (${agoLabel(f.createdAt)}) — "${excerpt(f.suggestion, 140)}"`,
            ),
        },
  );

  directives.push(
    feedback === null
      ? failed("unread feedback reports")
      : {
          question: "unread feedback reports",
          method: `SQL: count(*) WHERE status = '${FEEDBACK_STATUS.NEW}'`,
          answer: [String(feedback.filter((f) => f.status === FEEDBACK_STATUS.NEW).length)],
        },
  );

  directives.push(
    approvals === null
      ? failed("drafts waiting for approval")
      : {
          question: "drafts waiting for approval",
          method: "SQL: actions WHERE status = 'draft'",
          answer: approvals.slice(0, 8).map((a) => `${a.title} (${a.type})`),
        },
  );

  directives.push(
    alerts === null
      ? failed("open alerts")
      : {
          question: "open alerts",
          method: "SQL: alerts WHERE dismissed = false, newest first",
          answer: alerts.slice(0, 8).map((a) => `[${a.severity}] ${a.title}`),
        },
  );

  return directives;
}
