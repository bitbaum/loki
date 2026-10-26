import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "@bitbaum/accountkit/auth/schema";
export * from "@bitbaum/accountkit/auth/schema";
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};
export const modelKey = pgTable("model_keys", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  vendor: text("vendor").notNull(),
  model: text("model").notNull(),
  sealedKey: text("sealed_key").notNull(),
  hint: text("hint").notNull(),
  ...timestamps,
});

export type User = typeof user.$inferSelect;
export type ModelKey = typeof modelKey.$inferSelect;
