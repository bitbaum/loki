import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { orchestrationRuns } from "./orchestration-runs";

/**
 * Run ledger — every hop of a run's life DECLARES itself as an append-only
 * event. Born from the 2026-07-02/03 incidents where every failure was a
 * silent gap between hops (dispatched-but-not-submitted, submitted-but-401,
 * finished-but-no-handoff): point-in-time state in scattered tables made
 * silence indistinguishable from progress. A run parked between events is
 * now visible by definition, and gap rules (reap-stale-runs) become
 * declarative timeouts per transition instead of one blanket reaper.
 * See docs/architecture (systems review, 2026-07-03) — Stage 1 of the
 * execution-substrate redesign.
 */
export const RUN_EVENT_KINDS = [
  "dispatched", // control plane assembled + queued the dispatch
  "claimed", // runner claimed the pending command
  "launched", // agent PTY created (fresh launch only)
  "submitted", // prompt verifiably submitted (CLI live status left idle)
  "generating", // agent confirmed generating
  "progress", // runner heartbeat: the agent's PTY printed since the last beat (detail.outputBytes)
  "blocked", // agent blocked on input / auth / dialog (detail.reason)
  "handoff", // session handoff received (pusher persisted it)
  "closed", // run closed with outcome (closeRunFromSession / reaper)
  // A closed run's outcome corrected after the fact: the reaper said
  // timeout, then found a PR it had pushed (reap-evidence). It used to be
  // a SECOND "closed", so a run's history read "closed, closed" and
  // looked like two runs ending (2026-09-25).
  "reclassified",
  "recorded", // changelog entry appended from the handoff
  "promoted", // changelog entry promoted to the OrangeCat wall
] as const;
export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

export const runEvents = pgTable(
  "run_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => orchestrationRuns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<RunEventKind>().notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_run_events_run_id").on(t.runId),
    index("idx_run_events_user_created").on(t.userId, t.createdAt),
  ],
);

export type RunEvent = typeof runEvents.$inferSelect;
export type NewRunEvent = typeof runEvents.$inferInsert;
