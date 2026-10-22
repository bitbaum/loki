import { Target } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { EmptyState } from "@/components/ui/empty-state";
import { getGoals, getGoalStats } from "@/db/queries/goals";
import { requirePageUserId } from "@/lib/session";
import { NewGoalButton } from "@/components/goals/NewGoalButton";
import { GoalsList } from "@/components/goals/GoalsList";
import { LokiDispatchButton } from "@/components/shared/LokiDispatchButton";
import { APP_NAME } from "@/config/brand";
import { GOAL_STATUS } from "@/lib/constants/statuses";

export const metadata = { title: "Goals" };

/** "3 goals, 48% done on average. 2 finished." — the page's numbers as one sentence. */
function summary(stats: Awaited<ReturnType<typeof getGoalStats>>): string {
  const open =
    stats.active === 0
      ? "No open goals."
      : `${stats.active} ${stats.active === 1 ? "goal" : "goals"}, ${stats.avgProgress}% done on average.`;
  const finished = stats.completed > 0 ? ` ${stats.completed} finished.` : "";
  return open + finished;
}

export default async function GoalsPage() {
  const userId = await requirePageUserId();
  const [goalTree, stats] = await Promise.all([getGoals(userId), getGoalStats(userId)]);

  const activeGoals = goalTree.filter((g) => g.status === GOAL_STATUS.ACTIVE || !g.status);
  const completedGoals = goalTree.filter((g) => g.status === GOAL_STATUS.COMPLETED);
  const abandonedGoals = goalTree.filter((g) => g.status === GOAL_STATUS.ABANDONED);

  return (
    <PageLayout
      title="Goals"
      maxWidth="max-w-2xl"
      action={<NewGoalButton goals={activeGoals} trigger="page-action" />}
    >
      {goalTree.length === 0 ? (
        <EmptyState
          icon={Target}
          title="What are you working toward?"
          action={
            <LokiDispatchButton
              prompt={`I'm starting to track my goals in ${APP_NAME}. I'm a builder running multiple projects.\n\nHelp me think through what my top 2–3 goals should be right now. What areas should I consider (professional, health, learning, relationships, financial)? What makes a good goal versus just a task?`}
              label="Work it out with Loki"
              title="Work out your goals with Loki"
              className="ui-btn-secondary"
            />
          }
        />
      ) : (
        <>
          <p className="ui-life-summary">{summary(stats)}</p>
          <GoalsList
            activeGoals={activeGoals}
            completedGoals={completedGoals}
            abandonedGoals={abandonedGoals}
          />
        </>
      )}
    </PageLayout>
  );
}
