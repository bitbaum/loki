import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { userProjects } from "./user-projects";
import type { PackageBump } from "@/lib/packages/dependabot";
import type { CiState, UpdateRequestState } from "@/lib/packages/update-policy";
import type { UpdateDecision } from "@/config/package-updates";

/**
 * Dependabot pull requests that update a fleet package in one of a person's
 * projects, as Loki last read them (src/lib/packages/updates.ts).
 *
 * Mostly observations — the pull request's head, its checks, whether it is
 * still open — refreshed on every read; GitHub is the truth and these rows
 * are a cache of it. Three things here are Loki's own and are NOT read back
 * from GitHub, because GitHub cannot say them:
 *
 *   - `held_by_loki`: Loki put the `hold` label on. Loki only ever takes off a
 *     hold it put on — a hold a person added stays.
 *   - `decision` (+ `decided_at`, `snoozed_until`): what the person chose on
 *     the Approvals card — or "released" when someone took Loki's hold off on
 *     GitHub, after which Loki neither puts it back nor merges it.
 *   - `detail`: the last thing worth telling the person about this request
 *     (a write GitHub refused, a merge waiting on checks).
 *
 * One row per (project, pull request number). A closed or merged pull request
 * keeps its row, terminal, so the project page can say what happened.
 */
export const packageUpdateRequests = pgTable(
  "package_update_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => userProjects.id, { onDelete: "cascade" }),
    prNumber: integer("pr_number").notNull(),
    prUrl: text("pr_url").notNull(),
    title: text("title").notNull(),
    headSha: text("head_sha"),
    /** Every update the pull request makes; `fleet` marks the catalogue packages. */
    packages: jsonb("packages").$type<PackageBump[]>().notNull(),
    ciState: text("ci_state").$type<CiState>().notNull().default("unknown"),
    state: text("state").$type<UpdateRequestState>().notNull().default("open"),
    heldByLoki: boolean("held_by_loki").notNull().default(false),
    decision: text("decision").$type<UpdateDecision>(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    detail: text("detail"),
    /** When GitHub says the pull request was opened. */
    openedAt: timestamp("opened_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_package_update_requests_project_pr").on(t.projectId, t.prNumber),
    index("idx_package_update_requests_user_state").on(t.userId, t.state),
  ],
);

export type PackageUpdateRequestRow = typeof packageUpdateRequests.$inferSelect;
export type NewPackageUpdateRequestRow = typeof packageUpdateRequests.$inferInsert;
