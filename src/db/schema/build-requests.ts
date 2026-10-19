import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";
import { entities } from "./entities";
import type { BuildRequestStatus } from "@/config/build-requests";

/** The instant preview the visitor saw when they asked (config/instant-preview). */
export type BuildRequestLook = { before: string; after: string; summary: string | null };

/**
 * A new account's "Make it real" on /change, waiting for the operator
 * (config/build-requests). `brief` is the validated WebsiteBuildInput the
 * build will run from; the project, address and code are filled in when the
 * operator approves and the preview — the operator's client work — exists.
 */
export const buildRequests = pgTable(
  "build_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The brief's own request id: a double tap files one request, not two. */
    requestId: text("request_id").notNull(),
    website: text("website").notNull(),
    brief: jsonb("brief").$type<Record<string, unknown>>().notNull(),
    look: jsonb("look").$type<BuildRequestLook | null>(),
    status: text("status").$type<BuildRequestStatus>().notNull().default("waiting"),
    projectId: uuid("project_id").references(() => entities.id, { onDelete: "set null" }),
    previewUrl: text("preview_url"),
    /** The code that opens this one preview — never the operator's own. */
    accessCode: text("access_code"),
    note: text("note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("build_request_user_request").on(t.userId, t.requestId),
    index("build_request_status").on(t.status, t.createdAt),
  ],
);

export type BuildRequest = typeof buildRequests.$inferSelect;
