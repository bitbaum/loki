/**
 * Fact adapters for the FLEET side of Loki: what visitors reported, what
 * the agents did with it, which agents are working right now, what is alarming,
 * and the one-line pulse that ties them together.
 *
 * None of this existed before 2026-09-11. Loki's sources covered people,
 * projects, knowledge and the approval queue — the "life" half of the product —
 * and nothing on the "fleet" half: not the feedback table, not a single
 * orchestration run, not the runner. So the operator filed two reports through
 * the feedback widget, asked Loki "what was the most recent feedback sent", and
 * was told "Not in your data." — literally true of the facts Loki had been
 * handed, and useless. The reports were in the table; four runs spawned from
 * them sat in `waiting`. A fleet assistant that cannot see the fleet is a chat
 * box.
 *
 * Contract as everywhere else: values that were STORED, `<not recorded>` for
 * the rest. Visitor-written text is fenced as untrusted before it enters a
 * prompt — a feedback report is the one place an outsider can type into the
 * operator's assistant.
 */
import { makeFact, type Fact } from "@bitbaum/ai-kit/grounding";
import { listUserFeedback } from "@/db/queries/site-feedback";
import { listRecentRuns, countRunsByStateSince } from "@/db/queries/orchestration-runs";
import { getOpenAgentTurns } from "@/db/queries/agent-sessions";
import { getActiveAlerts } from "@/db/queries/alerts";
import { getExecutionAccess } from "@/lib/execution-access";
import { builderStatusLine } from "@/lib/builder-way-forward";
import { getPendingActions } from "@/db/queries/actions";
import { readUserBudget } from "@/lib/ai/budget";
import { inlineUntrusted } from "@/lib/feedback/untrusted";
import { FEEDBACK_STATUS, type FeedbackStatus } from "@/lib/constants/statuses";
import { ORCH_STATE, type OrchestrationState } from "@/lib/orchestration/contract";
import { DAY_MS } from "@/lib/constants/time";
import { dateLabel, timeLabel, agoLabel, excerpt } from "@/lib/agent/fact-utils";

const SUGGESTION_MAX = 320;
const RUN_TEXT_MAX = 200;

/**
 * Visitor feedback, newest first, optionally narrowed by status or project.
 *
 * `listUserFeedback` is the same read the /feedback inbox uses — one
 * definition of "the operator's feedback", so what Loki says and what the page
 * shows cannot disagree. The screenshot column is excluded there already.
 */
export async function feedbackFacts(
  userId: string,
  opts: { limit: number; status?: FeedbackStatus; projectName?: string },
): Promise<Fact[]> {
  const rows = await listUserFeedback(userId, 200).catch(() => []);
  const wantedProject = opts.projectName?.trim().toLowerCase();
  return rows
    .filter((r) => !opts.status || r.status === opts.status)
    .filter((r) => !wantedProject || r.projectName.toLowerCase().includes(wantedProject))
    .slice(0, opts.limit)
    .map((r) =>
      makeFact({
        kind: "feedback",
        subject: `feedback on ${r.projectName}: ${excerpt(r.suggestion, 50) ?? "(empty)"}`,
        source: "site_feedback table (visitor-written — untrusted text)",
        values: {
          project: r.projectName,
          // The visitor wrote this. It is wrapped so the model reads it as a
          // quoted report, not as an instruction addressed to it.
          report: inlineUntrusted(r.suggestion, SUGGESTION_MAX),
          page: r.page,
          status: r.status,
          filed: timeLabel(r.createdAt),
          age: agoLabel(r.createdAt),
          source: r.source,
          contact: r.contact,
          duplicates: r.duplicateCount > 1 ? `${r.duplicateCount} identical reports` : null,
          dispatched_run: r.dispatchedRunId ? r.dispatchedRunId.slice(0, 8) : null,
          resolved: dateLabel(r.resolvedAt),
          id: r.id.slice(0, 8),
        },
      }),
    );
}

/**
 * Agent runs, newest first — "did it finish", "what is waiting", "what failed".
 *
 * A run's state and outcome are two different questions and both are kept:
 * `waiting` with no outcome is a run nobody has picked up; `done` with
 * `partial` is a run that ended without a clean result. The summary fields are
 * the agent's own handoff, quoted as such.
 */
export async function runFacts(
  userId: string,
  opts: { limit: number; states?: OrchestrationState[]; projectKey?: string; sinceMs?: number },
): Promise<Fact[]> {
  const rows = await listRecentRuns(userId, opts).catch(() => []);
  return rows.map((r) =>
    makeFact({
      kind: "run",
      subject: `${r.projectKey} · ${r.intent} · ${r.state}${r.outcome ? ` (${r.outcome})` : ""}`,
      source: "orchestration_runs table",
      values: {
        project: r.projectKey,
        intent: r.intent,
        agent: r.adapter,
        state: r.state,
        outcome: r.outcome,
        started: timeLabel(r.startedAt),
        age: agoLabel(r.startedAt),
        finished: timeLabel(r.finishedAt),
        error: excerpt(r.error, RUN_TEXT_MAX),
        note: excerpt(r.note, RUN_TEXT_MAX),
        agent_status: excerpt(r.summaryStatus, RUN_TEXT_MAX),
        agent_done: excerpt(r.summaryDone, RUN_TEXT_MAX),
        agent_next: excerpt(r.summaryNext, RUN_TEXT_MAX),
        commit: r.commit,
        id: r.id.slice(0, 8),
      },
    }),
  );
}

/** Agents working RIGHT NOW, by their own report (Claude Code hooks). */
export async function sessionFacts(userId: string): Promise<Fact[]> {
  const rows = await getOpenAgentTurns(userId).catch(() => []);
  return rows.map((s) =>
    makeFact({
      kind: "agent_session",
      subject: `${s.projectKey} · ${s.agent} working`,
      source: "agent_sessions table (agent-reported, open turn)",
      values: {
        project: s.projectKey,
        agent: s.agent,
        started: timeLabel(s.startedAt),
        age: agoLabel(s.startedAt),
        directory: s.cwd,
      },
    }),
  );
}

/** Open alerts — what Loki itself flagged and the operator has not dismissed. */
export async function alertFacts(userId: string, limit: number): Promise<Fact[]> {
  const rows = await getActiveAlerts(userId).catch(() => []);
  return rows.slice(0, limit).map((a) =>
    makeFact({
      kind: "alert",
      subject: a.title,
      source: "alerts table",
      values: {
        title: a.title,
        severity: a.severity,
        type: a.type,
        detail: excerpt(a.description, RUN_TEXT_MAX),
        raised: timeLabel(a.createdAt),
        age: agoLabel(a.createdAt),
        link: a.actionUrl,
      },
    }),
  );
}

/**
 * The fleet's pulse as ONE fact: counts the operator would otherwise have to
 * open five pages to assemble.
 *
 * Computed in SQL, phrased by the model. A language model can only add error
 * to "how many runs are waiting" — hand it the number. This is the fact that
 * makes "what needs me?" answerable on a single call with no tools.
 */
export async function fleetStatusFacts(userId: string): Promise<Fact[]> {
  const [access, runs24h, waiting, sessions, alerts, approvals, feedbackNew, budget] =
    await Promise.all([
      getExecutionAccess(userId).catch(() => null),
      countRunsByStateSince(userId, DAY_MS).catch(() => null),
      listRecentRuns(userId, { states: [ORCH_STATE.WAITING], limit: 50 }).catch(() => null),
      getOpenAgentTurns(userId).catch(() => null),
      getActiveAlerts(userId).catch(() => null),
      getPendingActions(userId).catch(() => null),
      listUserFeedback(userId, 200)
        .then((rows) => rows.filter((r) => r.status === FEEDBACK_STATUS.NEW))
        .catch(() => null),
      readUserBudget(userId).catch(() => null),
    ]);

  const n = (v: unknown[] | null) => (v === null ? null : String(v.length));
  const oldestWaiting = waiting && waiting.length > 0 ? waiting[waiting.length - 1] : null;

  return [
    makeFact({
      kind: "fleet_status",
      subject: "fleet status right now",
      source:
        "computed from runner_presence, orchestration_runs, agent_sessions, alerts, actions, site_feedback, ai_spend, own_model_usage, provider_quota",
      values: {
        builder: builderStatusLine(access),
        agents_working_now: n(sessions),
        runs_waiting_for_a_builder: n(waiting),
        oldest_waiting_run: oldestWaiting
          ? `${oldestWaiting.projectKey}, waiting since ${timeLabel(oldestWaiting.startedAt)} (${agoLabel(oldestWaiting.startedAt)})`
          : waiting
            ? "none"
            : null,
        runs_last_24h:
          runs24h === null
            ? null
            : Object.entries(runs24h)
                .map(([state, count]) => `${count} ${state}`)
                .join(", ") || "none",
        runs_errored_last_24h: runs24h === null ? null : String(runs24h[ORCH_STATE.ERROR] ?? 0),
        open_alerts: n(alerts),
        approvals_pending: n(approvals),
        feedback_unread: n(feedbackNew),
        // The same sentence Settings → AI and the picker show, so Loki's answer
        // to "how much do I have left" cannot disagree with the screen.
        ai_budget_today: budget === null ? null : budget.headline,
      },
    }),
  ];
}
