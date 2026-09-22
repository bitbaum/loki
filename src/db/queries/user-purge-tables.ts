/**
 * Which tables `deleteUserAccount` must clear before the users row, and why.
 *
 * This lives apart from users.ts on purpose: users.ts imports `@/db`, which
 * opens a database client at module load, so anything importing it needs
 * DATABASE_URL set. These are pure schema references with no business touching
 * a connection, and keeping them here is what lets
 * `scripts/test/account-deletion-covers-every-table.ts` check them in CI,
 * where there is no database. (Same reasoning as the deferred debug-logs
 * import in src/lib/email.ts.)
 */
import {
  actions,
  alerts,
  attributes,
  claudeCodeHistory,
  commitments,
  entities,
  entityRelations,
  events,
  goals,
  habitCompletions,
  habits,
  interactions,
  invitations,
  orchestrationRuns,
  promptHistory,
  siteFeedback,
  subscriptions,
} from "@/db/schema";

/**
 * Tables cleared BY HAND, in this order, before the users row.
 *
 * Most user-owned tables declare onDelete:"cascade" and purge automatically.
 * These do not (plain `references(() => users.id)`), so a users delete would
 * raise a foreign-key violation with any of them still populated.
 *
 * The order is a real decision, not an accident: interactions / attributes /
 * entity_relations cascade from `entities` via entity_id, but each ALSO
 * carries its own non-cascading user_id. Clearing them by user_id first is
 * what stops a row this user owns, pointing at SOMEONE ELSE'S entity, from
 * surviving and blocking the delete.
 */
export const USER_PURGE_ORDER = [
  siteFeedback,
  claudeCodeHistory,
  promptHistory,
  subscriptions,
  alerts,
  actions,
  commitments,
  goals,
  events,
  // orchestration_runs: run_events cascade from it via run_id.
  orchestrationRuns,
  // habits: habit_completions cascade via habit_id, but rows can also carry
  // this user_id directly, so clear them first.
  habitCompletions,
  habits,
  // Knowledge graph: children by user_id, then the entities themselves.
  interactions,
  attributes,
  entityRelations,
  entities,
] as const;

/**
 * Non-cascading user FKs that are DETACHED rather than deleted, because the
 * row belongs to somebody else. `invitations.used_by` records who redeemed an
 * invite; the invite itself belongs to whoever created it, so deleting the
 * redeemer must not delete their invite.
 *
 * The gate treats these as covered. Keep the reason with the entry — an
 * unexplained exemption is how a table quietly stops being purged.
 */
export const USER_DETACHED_COLUMNS = [{ table: invitations, column: "used_by" as const }] as const;
