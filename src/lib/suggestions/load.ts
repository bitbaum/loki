/**
 * Gather one person's /suggestions board — server only.
 *
 * Every read is one a page already trusts (Today, Crew, Goals, Money, People,
 * Habits, the /loki build row), so a suggestion and the page it points at
 * cannot disagree. Each read is best-effort: a failed query contributes
 * nothing rather than failing the board. The private avenues (people, money,
 * habits — config/suggestion-avenues.ts) are read only while the PIN zone is
 * unlocked; locked, they are reported as such and the page says so.
 */
import { getTodayHabits } from "@/db/queries/habits";
import { getEventsDueSoon } from "@/db/queries/events";
import { listOpenHumanTasks } from "@/db/queries/human-tasks";
import { searchPeople } from "@/db/queries/people";
import { listSuggestionDecisions } from "@/db/queries/suggestion-decisions";
import { getGoalsDueSoon, getUpcomingSubscriptions } from "@/db/queries/today";
import { SUGGESTION_AVENUES, type AvenueId } from "@/config/suggestion-avenues";
import { loadSuggestionInputs } from "@/lib/build-suggestions/load";
import { rankBuildSuggestions } from "@/lib/build-suggestions/rank";
import { SORT_MODE } from "@/lib/constants/statuses";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { buildBoard, type SuggestionBoard } from "./board";
import { EMPTY_LIFE_INPUTS, lifeCandidates, type LifeInputs } from "./life";

const RENEWAL_DAYS = 7;
const GOAL_DUE_DAYS = 14;
const EVENT_DUE_DAYS = 7;
const STALE_PEOPLE_FETCH = 10;
const CREW_TASK_FETCH = 20;
/** Large enough to be "everything": the board re-sorts across avenues itself. */
const BUILD_ALL = 500;

async function loadPublicLife(userId: string): Promise<Partial<LifeInputs>> {
  const [crew, goals, events] = await Promise.all([
    listOpenHumanTasks(userId, CREW_TASK_FETCH).catch(() => []),
    getGoalsDueSoon(userId, GOAL_DUE_DAYS).catch(() => []),
    getEventsDueSoon(userId, EVENT_DUE_DAYS).catch(() => []),
  ]);
  return {
    crewTasks: crew.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assigneeName: t.assigneeName,
      updatedAt: new Date(t.updatedAt).toISOString(),
    })),
    goalsDue: goals
      .filter((g) => g.targetDate)
      .map((g) => ({
        id: g.id,
        title: g.title,
        progress: g.progress ?? 0,
        targetDate: new Date(g.targetDate as Date).toISOString(),
      })),
    eventsDue: events
      .filter((e) => e.deadline)
      .map((e) => ({
        id: e.id,
        title: e.name,
        type: e.type,
        deadline: new Date(e.deadline as Date).toISOString(),
      })),
  };
}

async function loadPrivateLife(userId: string): Promise<Partial<LifeInputs>> {
  const [habits, renewals, people] = await Promise.all([
    getTodayHabits(userId).catch(() => []),
    getUpcomingSubscriptions(userId, RENEWAL_DAYS).catch(() => []),
    searchPeople(userId, "", STALE_PEOPLE_FETCH, 0, SORT_MODE.RECENT, ["stale"]).catch(() => ({
      people: [],
      total: 0,
    })),
  ]);
  return {
    habits: habits.map((h) => ({
      id: h.id,
      title: h.title,
      frequency: h.frequency,
      doneToday: h.doneToday,
      streak: h.streak,
    })),
    renewals: renewals.map((r) => ({
      id: r.id,
      name: r.name,
      amount: r.amount,
      currency: r.currency,
      frequency: r.frequency,
      nextCharge: r.nextCharge.toISOString(),
    })),
    stalePeople: people.people.map((p) => ({
      id: p.id,
      name: p.name,
      lastInteraction: p.lastInteraction ? p.lastInteraction.toISOString() : null,
    })),
  };
}

export async function loadSuggestionBoard(userId: string): Promise<SuggestionBoard> {
  const locked = await isPrivateZoneLocked(userId);
  const [buildInputs, decisions, publicLife, privateLife] = await Promise.all([
    loadSuggestionInputs(userId),
    listSuggestionDecisions(userId).catch(() => []),
    loadPublicLife(userId),
    locked ? Promise.resolve({}) : loadPrivateLife(userId),
  ]);
  const build = rankBuildSuggestions(buildInputs, { limit: BUILD_ALL }).suggestions;
  const life = lifeCandidates({ ...EMPTY_LIFE_INPUTS, ...publicLife, ...privateLife });
  const lockedAvenues: AvenueId[] = locked
    ? SUGGESTION_AVENUES.filter((a) => a.private).map((a) => a.id)
    : [];
  return buildBoard({ suggestions: [...build, ...life], decisions, lockedAvenues });
}
