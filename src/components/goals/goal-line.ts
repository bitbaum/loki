import { deadlineLabel } from "@/lib/dates";
import { projectTitle } from "@/lib/project-display";
import { GOAL_STATUS } from "@/lib/constants/statuses";
import type { GoalWithChildren } from "@/db/queries/goals";

/**
 * A goal's one grey line: when it is due, the project it belongs to, and how
 * many sub-goals sit under it — only what is there. Milestones are on the
 * goal's own page: on a phone the line ran out before it reached the project.
 * Shared by the list and a goal's own sub-goal rows.
 */
export function goalLine(goal: GoalWithChildren): { text: string; overdue: boolean } {
  const closed = goal.status === GOAL_STATUS.COMPLETED || goal.status === GOAL_STATUS.ABANDONED;
  const due = !closed && goal.targetDate ? deadlineLabel(goal.targetDate) : null;
  const parts = [
    goal.status === GOAL_STATUS.ABANDONED ? "Set aside" : null,
    due?.label ?? null,
    goal.entityName ? projectTitle({ name: goal.entityName, title: goal.entityTitle }) : null,
    goal.children.length > 0
      ? `${goal.children.length} ${goal.children.length === 1 ? "sub-goal" : "sub-goals"}`
      : null,
  ].filter(Boolean);
  return { text: parts.join(" · ") || "No date set", overdue: !!due?.overdue };
}

export function goalProgress(goal: GoalWithChildren): number {
  return goal.status === GOAL_STATUS.COMPLETED ? 100 : (goal.progress ?? 0);
}
