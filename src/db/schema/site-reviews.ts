import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { entities } from "./entities";
import type {
  ReviewMode,
  ReviewStatus,
  ReviewFrame,
  ReviewCoverage,
  ReviewFinding,
} from "@/lib/inspection/contract";

export const siteReviews = pgTable(
  "site_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    mode: text("mode").$type<ReviewMode>().notNull(),
    url: text("url").notNull(),
    paths: jsonb("paths").$type<string[]>().notNull().default([]),
    status: text("status").$type<ReviewStatus>().notNull().default("queued"),
    tokenHash: text("token_hash").notNull(),
    workerId: text("worker_id"),
    workerState: text("worker_state").notNull().default("queued"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    frame: jsonb("frame").$type<ReviewFrame>(),
    coverage: jsonb("coverage").$type<ReviewCoverage[]>().notNull().default([]),
    findingCount: integer("finding_count").notNull().default(0),
    eventCount: integer("event_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_site_reviews_owner_project").on(t.userId, t.projectId),
    uniqueIndex("uq_site_reviews_active")
      .on(t.userId, t.projectId)
      .where(sql`${t.status} IN ('queued', 'running', 'paused')`),
  ],
);
export const siteReviewEvents = pgTable(
  "site_review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => siteReviews.id, { onDelete: "cascade" }),
    kind: text("kind")
      .$type<"observation" | "finding" | "user" | "assistant" | "dispatch">()
      .notNull(),
    text: text("text").notNull(),
    finding: jsonb("finding").$type<ReviewFinding>(),
    image: text("image"),
    runId: uuid("run_id"),
    fixRequestedAt: timestamp("fix_requested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_site_review_events_review").on(t.reviewId, t.createdAt)],
);
export type SiteReview = typeof siteReviews.$inferSelect;
export type SiteReviewEvent = typeof siteReviewEvents.$inferSelect;
