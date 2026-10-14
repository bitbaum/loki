import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Releases their package's owner paused everywhere — the kill switch on the
 * package page ("Pause v0.3.0 everywhere"; src/config/package-releases.ts).
 *
 * One row per (package, version) while it is paused; resuming deletes the
 * row. It is a DECISION, the only one here — everything it causes is derived:
 * the package-update sync (src/lib/packages/updates.ts) holds every open
 * update that moves `package_name` TO `version`, in every project and
 * whatever the project's setting, and lifts only the holds that nothing else
 * wants once the row is gone. Which updates are paused is never stored on
 * the update rows; it is matched from these rows on every read
 * (src/lib/packages/release-pause.ts), so it cannot drift from them.
 *
 * `user_id` is who paused it. `version` carries no `v`.
 */
export const packageReleasePauses = pgTable(
  "package_release_pauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    version: text("version").notNull(),
    pausedAt: timestamp("paused_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_package_release_pauses_package_version").on(t.packageName, t.version)],
);

export type PackageReleasePauseRow = typeof packageReleasePauses.$inferSelect;
