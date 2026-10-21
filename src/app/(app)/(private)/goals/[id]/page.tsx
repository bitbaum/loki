import { notFound } from "next/navigation";
import { getGoals, type GoalWithChildren } from "@/db/queries/goals";
import { getHabitsByGoalIds } from "@/db/queries/habit-goals";
import { requirePageUserId } from "@/lib/session";
import { GoalDetail } from "@/components/goals/GoalDetail";

export const metadata = { title: "Goal" };

/** The goal and the goal it sits under, found in the owner's own tree. */
function findGoal(
  goals: GoalWithChildren[],
  id: string,
  parent: GoalWithChildren | null = null,
): { goal: GoalWithChildren; parent: GoalWithChildren | null } | null {
  for (const g of goals) {
    if (g.id === id) return { goal: g, parent };
    const hit = findGoal(g.children, id, g);
    if (hit) return hit;
  }
  return null;
}

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requirePageUserId();
  const { id } = await params;
  const found = findGoal(await getGoals(userId), id);
  if (!found) notFound();
  const habits = (await getHabitsByGoalIds(userId, [id])).get(id) ?? [];

  return (
    <GoalDetail
      // A goal reached from its sub-goal row is a different page with the same
      // component: keyed so its state starts from the goal it now shows.
      key={found.goal.id}
      goal={found.goal}
      parent={found.parent ? { id: found.parent.id, title: found.parent.title } : null}
      habits={habits}
    />
  );
}
