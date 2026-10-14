/**
 * The stored shapes of a kit plan — type-only, so the Drizzle schema can name
 * them without importing any of the planning code.
 */

/** user_projects.kit_plan: what the kickoff planned, for the "Built from" panel. */
export type KitPlanRecord = {
  /** When the first build was briefed with this plan (ISO). */
  plannedAt: string;
  /** Catalogue name + the plain word the owner was shown, in plan order. */
  kits: Array<{ name: string; slug: string; plain: string }>;
  /** The build was told to replace the fleet's tokens with the client's. */
  clientTokens: boolean;
};

/** orchestration_runs.payload.kitPlan: planned at dispatch, observed after the build. */
export type KitRunRecord = {
  /** Catalogue names the kickoff planned, in plan order. */
  planned: string[];
  /** Catalogue names the first read after the build observed (all of them, planned or not). */
  observed?: string[];
  /** When `observed` was read (ISO). */
  observedAt?: string;
};
