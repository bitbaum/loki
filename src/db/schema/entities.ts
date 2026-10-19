import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";
import { type EntityType } from "@/lib/constants/statuses";

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    /** What a PERSON calls the project, when it differs from `name`. `name`
     *  is a key — activity, runs and cron jobs are found by it, so renaming
     *  it hides a project's past — and it carries whatever a flow minted
     *  ("xhiva-art-refresh-300d…"). The title is free to change; read it
     *  through projectTitle() (lib/project-display), never directly. */
    title: text("title"),
    type: text("type").$type<EntityType>().notNull(),
    externalId: text("external_id"),
    description: text("description"),
    /** Canonical repo URL for project entities (e.g. https://github.com/user/repo).
     *  Nullable because non-project entities (people, commitments, ...) never
     *  have one, and projects added before this column existed may still lack
     *  it. Used by /control + /projects to render an "Open repo" link.
     *  Populated by /api/projects/create-with-github + bulk-from-github +
     *  import-from-local. */
    gitUrl: text("git_url"),
    /** Per-project override for the user's beacon_settings.auto_inject_mode.
     *  NULL = inherit the user-level mode (today's behavior). Set to any
     *  AUTO_INJECT_MODE_VALUES value to pin this specific project to a
     *  different autopilot tier — e.g. user is on "strategist" globally but
     *  flips this one project to "off" while iterating on something fragile.
     *  Read by /api/control/dispatch before falling back to user default. */
    autoInjectModeOverride: text("auto_inject_mode_override"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_entities_type").on(table.type),
    index("idx_entities_user_id").on(table.userId),
    index("idx_entities_external_id").on(table.externalId),
    index("idx_entities_source").on(table.source),
    uniqueIndex("uq_entities_user_name_type").on(table.userId, table.name, table.type),
  ],
);

export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
