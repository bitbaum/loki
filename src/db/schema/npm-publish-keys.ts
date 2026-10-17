import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * The npm key a person handed Loki so their packages reach npm without a
 * computer (src/lib/packages/npm-publish.ts).
 *
 * npm lets only the account itself create a package or link it to GitHub, so
 * a package's FIRST version needs a key from the account. The owner makes one
 * on npmjs.com from a phone and pastes it into Loki once; Loki writes it into
 * each new package's repository as a GitHub secret and starts its publish.yml,
 * which publishes the first version and links itself as trusted publisher.
 * Every later release is tokenless.
 *
 * `sealed` is the key under secret-box.ts — never returned to a browser.
 * `expires_at` is when npm will stop accepting it; past that Loki stops using
 * it and says so. `attempts` maps a package name to when Loki last started
 * its first publish, so the 15-minute cron does not restart a run in flight.
 */
export const npmPublishKeys = pgTable("npm_publish_keys", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  sealed: text("sealed").notNull(),
  npmUser: text("npm_user"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  attempts: jsonb("attempts").$type<Record<string, string>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type NpmPublishKeyRow = typeof npmPublishKeys.$inferSelect;
