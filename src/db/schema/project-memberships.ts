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

/**
 * An invitation into ONE project for someone who may not have an account yet.
 *
 * Adding a collaborator used to require an existing Loki account ("Ask them to
 * register first"), and the only other invite path created a local-password
 * account and dropped it into the inviter's whole org — broader than one
 * project, and a second identity path beside OrangeCat. This one grants exactly
 * `role` on exactly `projectId`, to whoever signs in with `email`.
 *
 * Only a SHA-256 of the token is stored. The raw token exists in the link and
 * nowhere else, so a leaked backup cannot be replayed as a set of invite links.
 */
export const projectInvitations = pgTable(
  "project_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    /** Lower-cased. Acceptance requires the signed-in account to match it. */
    email: text("email").notNull(),
    role: text("role").$type<ProjectRole>().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_project_invitations_project").on(t.projectId),
    index("idx_project_invitations_email").on(t.email),
  ],
);

export type ProjectInvitation = typeof projectInvitations.$inferSelect;
