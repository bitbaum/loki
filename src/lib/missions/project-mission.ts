/**
 * Missions are a view of an EXISTING Loki project, not a second task system.
 *
 * Project attrs own the purpose/next-step, Goals owns milestone reporting,
 * and orchestration_runs owns execution evidence. This pure projector MUST
 * never describe a checked goal or a successful agent response as independently
 * verified completion.
 */
import { GOAL_STATUS } from "@/lib/constants/statuses";

export type MissionGoalInput = {
  id: string;
  title: string;
  status: string | null;
  progress: number | null;
  description?: string | null;
  milestones?: readonly { title: string; done: boolean }[] | null;
};

export type MissionSource = {
  projectId: string;
  name: string;
  mission: string | null | undefined;
  nextStep: string | null | undefined;
  goals: readonly MissionGoalInput[];
};

export type MissionPhase = "needs-objective" | "ready" | "in-progress" | "reported-complete";

export type MissionProjection = {
  projectId: string;
  name: string;
  statement: string | null;
  phase: MissionPhase;
  /** This percentage is self-reported from Goals, NOT an audit score. */
  reportedProgress: number | null;
  goalsTotal: number;
  goalsReportedDone: number;
  nextObjective: string | null;
  objectives: readonly (MissionGoalInput & { reportedDone: boolean })[];
};

function nonblank(text: string | null | undefined): string | null {
  return text?.trim() || null;
}

export function missionFromProject(source: MissionSource): MissionProjection {
  const objectives = source.goals
    .filter((g) => g.status !== GOAL_STATUS.ABANDONED)
    .map((g) => ({
      ...g,
      reportedDone: g.status === GOAL_STATUS.COMPLETED,
    }));

  const goalsReportedDone = objectives.filter((goal) => goal.reportedDone).length;
  const goalsTotal = objectives.length;
  const progressValues = objectives.map((goal) =>
    goal.reportedDone
      ? 100
      : typeof goal.progress === "number" && Number.isFinite(goal.progress)
        ? Math.max(0, Math.min(99, goal.progress))
        : 0,
  );
  const reportedProgress = goalsTotal
    ? Math.round(progressValues.reduce((sum, progress) => sum + progress, 0) / goalsTotal)
    : null;
  const nextObjective =
    nonblank(source.nextStep) ||
    nonblank(objectives.find((goal) => !goal.reportedDone)?.title) ||
    null;
  const statement = nonblank(source.mission);
  const phase: MissionPhase =
    goalsTotal > 0 && goalsReportedDone === goalsTotal
      ? "reported-complete"
      : progressValues.some((progress) => progress > 0) || goalsReportedDone > 0
        ? "in-progress"
        : statement || goalsTotal > 0 || nextObjective
          ? "ready"
          : "needs-objective";

  return {
    projectId: source.projectId,
    name: source.name,
    statement,
    phase,
    reportedProgress,
    goalsTotal,
    goalsReportedDone,
    nextObjective,
    objectives,
  };
}
