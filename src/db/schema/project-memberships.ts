import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { entities } from "./entities";
import { users } from "./users";

export const PROJECT_ROLE_VALUES = ["editor", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLE_VALUES)[number];

/** Explicit per-project access. Ownership remains canonical on user_projects;
 * this table records only additional collaborators. */
export const projectMemberships = pgTable(
  "project_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<ProjectRole>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("uq_project_memberships_project_user").on(t.projectId, t.userId),
    index("idx_project_memberships_user").on(t.userId),
  ],
);

export type ProjectMembership = typeof projectMemberships.$inferSelect;
