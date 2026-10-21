import { deadlineLabel } from "@/lib/dates";
import { projectTitle } from "@/lib/project-display";
import { GOAL_STATUS } from "@/lib/constants/statuses";
import type { GoalWithChildren } from "@/db/queries/goals";

/**
 * A goal's one grey line: when it is due, how its milestones stand, how many
 * sub-goals sit under it, and the project it belongs to — in that order, and
 * only what is there. Shared by the list and a goal's own sub-goal rows.
 */
export function goalLine(goal: GoalWithChildren): { text: string; overdue: boolean } {
  const closed = goal.status === GOAL_STATUS.COMPLETED || goal.status === GOAL_STATUS.ABANDONED;
  const due = !closed && goal.targetDate ? deadlineLabel(goal.targetDate) : null;
  const milestones = goal.milestones ?? [];
  const done = milestones.filter((m) => m.done).length;
  const parts = [
    goal.status === GOAL_STATUS.ABANDONED ? "Set aside" : null,
    due?.label ?? null,
    milestones.length > 0 ? `${done} of ${milestones.length} milestones` : null,
    goal.children.length > 0
      ? `${goal.children.length} ${goal.children.length === 1 ? "sub-goal" : "sub-goals"}`
      : null,
    goal.entityName ? projectTitle({ name: goal.entityName }) : null,
  ].filter(Boolean);
  return { text: parts.join(" · ") || "No date set", overdue: !!due?.overdue };
}

export function goalProgress(goal: GoalWithChildren): number {
  return goal.status === GOAL_STATUS.COMPLETED ? 100 : (goal.progress ?? 0);
}
