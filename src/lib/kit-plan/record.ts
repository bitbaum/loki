/**
 * Writing the kit plan down, and freezing what the first build installed.
 *
 * Two records, two jobs. The project row (user_projects.kit_plan) is what the
 * "Built from" panel shows as planned. The kickoff run's payload
 * (orchestration_runs.payload.kitPlan) is the measurement: planned at
 * dispatch, observed once the repository is read after the build has landed,
 * so kit coverage (./coverage.ts) can be computed per site without a dashboard.
 * Neither ever writes project_packages — those rows are observations only.
 *
 * Both writes are best-effort: a failed record must never fail a dispatch.
 */
import { getLatestKitRun, setProjectKitPlan } from "@/db/queries/kit-plan";
import { mergeRunPayload } from "@/db/queries/orchestration-runs";
import { shouldRecordObserved } from "./coverage";
import type { ProjectKitPlan } from "./for-project";
import { toKitPlanRecord } from "./plan";

export async function recordKitPlan(args: {
  ownerId: string;
  userProjectId: string | null;
  runId: string | null;
  kit: ProjectKitPlan;
}): Promise<void> {
  const { ownerId, userProjectId, runId, kit } = args;
  await Promise.all([
    userProjectId
      ? setProjectKitPlan(ownerId, userProjectId, toKitPlanRecord(kit.plan, kit)).catch((e) =>
          console.error("[kit-plan] project record failed:", e instanceof Error ? e.message : e),
        )
      : null,
    runId
      ? mergeRunPayload(runId, { kitPlan: { planned: kit.plan.kits.map((k) => k.name) } }).catch(
          () => undefined,
        )
      : null,
  ]);
}

/**
 * Once the repository has been read after the first build landed, freeze what
 * it observed into the kickoff run. Called where the observations are read
 * (the project's planned-packages line); a no-op on every later call.
 */
export async function recordObservedIfDue(args: {
  ownerId: string;
  entityProjectId: string;
  scan: { scannedAt: Date; outcome: string } | null;
  observed: readonly string[];
}): Promise<void> {
  try {
    const run = await getLatestKitRun(args.ownerId, args.entityProjectId);
    if (
      !run ||
      !shouldRecordObserved({ record: run.record, runFinishedAt: run.finishedAt, scan: args.scan })
    ) {
      return;
    }
    await mergeRunPayload(run.id, {
      kitPlan: {
        planned: run.record.planned,
        observed: [...args.observed],
        observedAt: args.scan!.scannedAt.toISOString(),
      },
    });
  } catch (e) {
    console.error("[kit-plan] observed record failed:", e instanceof Error ? e.message : e);
  }
}
