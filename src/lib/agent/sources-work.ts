/**
 * Fact adapters for the operator's own work: goals, habits, commitments and
 * deadlines, the crew and what they hold, sticky-note captures.
 *
 * These used to be built inline in the tool handlers, which meant they existed
 * ONLY behind a tool call — a question about goals asked on a turn where the
 * tool loop could not run (rate-limited, or the prompt too big to fit a single
 * call) was answered from a context that had never heard of goals. One adapter
 * per domain, called by BOTH the seed builder and the tool handler, is the
 * shape that survived for approvals (#262) and is now the rule for everything.
 *
 * Same contract as sources.ts: a Fact carries only STORED values; a field the
 * table has no value for stays null and renders as `<not recorded>`.
 */
import { makeFact, type Fact } from "@bitbaum/ai-kit/grounding";
import { getGoals, type GoalWithChildren } from "@/db/queries/goals";
import { getTodayHabits } from "@/db/queries/habits";
import { listUpcomingCommitments } from "@/db/queries/today";
import { getEventsDueSoon } from "@/db/queries/events";
import { listCrew } from "@/db/queries/crew";
import { listOpenHumanTasks } from "@/db/queries/human-tasks";
import { listCaptures } from "@/db/queries/captures";
import { HUMAN_TASK_STATUS_LABEL, formatFee } from "@/config/crew";
import { dateLabel, agoLabel, excerpt } from "@/lib/agent/fact-utils";
import { loadBuildSuggestions } from "@/lib/build-suggestions/load";

const CAPTURE_MAX = 300;

/** Every active goal, sub-goals included — "which goal is stuck" must see all of them. */
export async function goalFacts(userId: string, limit: number): Promise<Fact[]> {
  const flatten = (nodes: GoalWithChildren[]): GoalWithChildren[] =>
    nodes.flatMap((g) => [g, ...flatten(g.children ?? [])]);
  const rows = flatten(await getGoals(userId).catch(() => [] as GoalWithChildren[]));
  return rows.slice(0, limit).map((g) =>
    makeFact({
      kind: "goal",
      subject: g.title,
      source: "goals table",
      values: {
        title: g.title,
        project: g.entityName,
        progress: g.progress === null || g.progress === undefined ? null : `${g.progress}%`,
        target_date: dateLabel(g.targetDate),
        last_updated: null,
      },
    }),
  );
}

/** Habits with today's check-off state and the streak on the line. */
export async function habitFacts(userId: string, limit: number): Promise<Fact[]> {
  const rows = await getTodayHabits(userId).catch(() => []);
  return rows.slice(0, limit).map((h) =>
    makeFact({
      kind: "habit",
      subject: h.title,
      source: "habits table",
      values: {
        title: h.title,
        frequency: h.frequency,
        current_streak: `${h.streak}`,
        last_checked: h.doneToday ? "done today" : "not yet done today",
      },
    }),
  );
}

/** Commitments and dated events inside a window — both tables, one answer. */
export async function commitmentFacts(userId: string, days: number): Promise<Fact[]> {
  const [commitments, events] = await Promise.all([
    listUpcomingCommitments(userId, days).catch(() => []),
    getEventsDueSoon(userId, days).catch(() => []),
  ]);
  return [
    ...commitments.map((c) =>
      makeFact({
        kind: "commitment",
        subject: c.description,
        source: "commitments table",
        values: {
          title: c.description,
          due: dateLabel(c.dueDate),
          counterparty: null,
          status: "active",
        },
      }),
    ),
    ...events.map((e) =>
      makeFact({
        kind: "event",
        subject: e.name,
        source: "events table",
        values: {
          name: e.name,
          type: e.type,
          deadline: dateLabel(e.deadline),
          url: e.url,
          status: e.status,
        },
      }),
    ),
  ];
}

/** The humans the operator delegates to. */
export async function crewFacts(userId: string, limit: number): Promise<Fact[]> {
  const crew = await listCrew(userId).catch(() => []);
  return crew.slice(0, limit).map((member) =>
    makeFact({
      kind: "crew_member",
      subject: member.name,
      source: "crew roster",
      values: {
        name: member.name,
        role: member.role,
        skills: member.skills.length ? member.skills.join(", ") : null,
        engagement: member.engagement,
        rate: member.rate,
        availability: member.availability,
        open_assignments: String(member.openTasks),
      },
    }),
  );
}

/** Open assignments handed to people — who has what, and whether they said yes. */
export async function humanTaskFacts(userId: string, limit: number): Promise<Fact[]> {
  const tasks = await listOpenHumanTasks(userId, limit).catch(() => []);
  return tasks.map((task) =>
    makeFact({
      kind: "assignment",
      subject: task.title,
      source: "crew board",
      values: {
        title: task.title,
        assignee: task.assigneeName,
        status: HUMAN_TASK_STATUS_LABEL[task.status],
        due: dateLabel(task.dueDate),
        fee: formatFee(task.feeAmount, task.feeCurrency) || null,
        why: task.reason,
      },
    }),
  );
}

/**
 * Sticky-note captures — the things the operator told Loki to remember.
 *
 * Loki could WRITE these (the sticky-note fast path) and never read them back,
 * so "what did I note about X" was unanswerable by the surface that took the
 * note. Newest first; the note body is the whole record.
 */
export async function captureFacts(userId: string, limit: number): Promise<Fact[]> {
  const rows = await listCaptures(userId, limit).catch(() => []);
  return rows.map((c) =>
    makeFact({
      kind: "note",
      subject: excerpt(c.body, 60) ?? "note",
      source: "sticky notes (captures table)",
      values: {
        note: excerpt(c.body, CAPTURE_MAX),
        captured: dateLabel(c.createdAt),
        age: agoLabel(c.createdAt),
      },
    }),
  );
}

/**
 * What the operator could build next — the same ranked list the /loki start
 * screen shows as "Build next" (src/lib/build-suggestions), so asking Loki
 * "what should I build?" and looking at the row give one answer. Each fact
 * carries the stored reason and the exact next move: the instruction to
 * dispatch, or the create link for a new build.
 */
export async function buildSuggestionFacts(userId: string, limit: number): Promise<Fact[]> {
  const { suggestions } = await loadBuildSuggestions(userId, { limit }).catch(() => ({
    suggestions: [],
  }));
  return suggestions.map((s) =>
    makeFact({
      kind: "document",
      subject: s.label,
      source: `build suggestions (ranked from the operator's own records) · ${s.kind}`,
      values: {
        title: s.label,
        source: s.project
          ? `build suggestion · project ${s.project}`
          : `build suggestion · ${s.kind}`,
        excerpt: `${s.why} Next move: ${s.prompt ?? `start it as a new project — ${s.href}`}`,
      },
    }),
  );
}
