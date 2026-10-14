import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";
import { userProjects } from "./user-projects";
import type { PackageSource } from "@/lib/packages/manifest";

/**
 * Which fleet packages each project is built from, as last read from its
 * repository (src/lib/packages/sync.ts).
 *
 * One row per (project, package): what package.json asks for (`spec`) and
 * what the lockfile resolved it to (`version`). Rows are observations, not
 * decisions — they are replaced by the next read, and a package the project
 * stopped using loses its row. What the project SHOULD be on (latest, a policy,
 * an approved rollout) is a later layer that reads these rows; it must never
 * be written into them, or an observation could not tell the truth about a
 * project that ignored a decision.
 *
 * `package_name` is the catalogue's name (bitbaum/fleet registers/packages.json),
 * whatever the project imports it as — `@fleet/ai-forms: npm:ai-forms@…` is
 * stored as `ai-forms`, so a package page finds every dependent by one key.
 */
export const projectPackages = pgTable(
  "project_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => userProjects.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    /** As written in package.json, e.g. `^1.20.1` or `github:bitbaum/listkit#v0.1.0`. */
    spec: text("spec").notNull(),
    /** Resolved from the lockfile; null when it cannot be known (no lockfile, a bare sha). */
    version: text("version"),
    source: text("source").$type<PackageSource>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
    /** The repository's head commit the observation was read at. */
    commitSha: text("commit_sha"),
    /**
     * The key package.json lists it under, when that is not `package_name`
     * (`@fleet/ai-forms` for an npm alias, `listkit` for a git dependency on
     * `@bitbaum/listkit`). Dependabot names an update by this key, so it is
     * how an update pull request is matched back to the catalogue. Null for
     * rows read before it was recorded: they match by `package_name` only
     * until the repository is read again.
     */
    depName: text("dep_name"),
  },
  (t) => [
    uniqueIndex("uq_project_packages_project_package").on(t.projectId, t.packageName),
    index("idx_project_packages_user_package").on(t.userId, t.packageName),
  ],
);

export type ProjectPackageRow = typeof projectPackages.$inferSelect;
export type NewProjectPackageRow = typeof projectPackages.$inferInsert;

/** How the last read of a project's repository went. */
export type PackageScanOutcome = "ok" | "no-manifest" | "unreachable" | "error";

/**
 * The last time each project's repository was read for packages — one row per
 * project, whether or not it uses any.
 *
 * Without it a project that uses no fleet package would look exactly like one
 * nobody has read, and the sync could not skip a repository whose head has not
 * moved. `catalogue_key` makes the skip honest: when fleet registers a new
 * package, an unchanged repository is still read again.
 */
export const projectPackageScans = pgTable(
  "project_package_scans",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => userProjects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    commitSha: text("commit_sha"),
    catalogueKey: text("catalogue_key"),
    outcome: text("outcome").$type<PackageScanOutcome>().notNull(),
    /** A short, human reason when the outcome is not "ok". */
    detail: text("detail"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_project_package_scans_user").on(t.userId, t.scannedAt)],
);

export type ProjectPackageScanRow = typeof projectPackageScans.$inferSelect;
