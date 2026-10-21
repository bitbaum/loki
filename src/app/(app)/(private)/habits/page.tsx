import { Repeat2 } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { EmptyState } from "@/components/ui/empty-state";
import { getAllHabitsWithHistory } from "@/db/queries/habits";
import { listActiveGoals } from "@/db/queries/goals";
import { getGoalsByHabitIds } from "@/db/queries/habit-goals";
import { requirePageUserId } from "@/lib/session";
import { HabitsList } from "@/components/habits/HabitsList";
import { NewHabitButton } from "@/components/habits/NewHabitButton";
import { HABIT_HISTORY_DAYS } from "@/lib/constants";
import { toLocalDateStr } from "@/lib/dates";

export const metadata = { title: "Habits" };

export default async function HabitsPage() {
  const userId = await requirePageUserId();
  const [habits, activeGoals] = await Promise.all([
    getAllHabitsWithHistory(userId, HABIT_HISTORY_DAYS),
    listActiveGoals(userId),
  ]);
  const linkedGoalsByHabit = await getGoalsByHabitIds(
    userId,
    habits.map((h) => h.id),
  );

  const active = habits.filter((h) => h.active);
  const today = toLocalDateStr(new Date());
  const doneToday = active.filter((h) => h.completedDates.has(today)).length;
  const bestStreak = habits.reduce((max, h) => Math.max(max, h.streak), 0);
  // The page's numbers as one sentence (design reset rule 7), not three tiles.
  const summary =
    active.length === 0
      ? "Every habit is paused."
      : `${doneToday} of ${active.length} done today.` +
        (bestStreak >= 2 ? ` Longest streak: ${bestStreak} days.` : "");

  return (
    <PageLayout
      title="Habits"
      maxWidth="max-w-2xl"
      action={<NewHabitButton trigger="page-action" />}
    >
      {habits.length === 0 ? (
        <EmptyState
          icon={Repeat2}
          title="Something you want to do every day?"
          action={<NewHabitButton triggerLabel="Add the first habit" />}
        />
      ) : (
        <>
          <p className="ui-life-summary">{summary}</p>
          <HabitsList
            habits={habits.map((h) => ({ ...h, completedDates: [...h.completedDates] }))}
            linkedGoals={Object.fromEntries(linkedGoalsByHabit)}
            activeGoals={activeGoals.map((g) => ({ id: g.id, title: g.title }))}
          />
        </>
      )}
    </PageLayout>
  );
}
