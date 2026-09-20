import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const beaconSettings = pgTable(
  "beacon_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    countdownSeconds: integer("countdown_seconds").notNull().default(12),
    whisperModel: text("whisper_model").notNull().default("base"),
    transcriptionProvider: text("transcription_provider").notNull().default("auto"),
    // off | on — autopilot is binary after the 2026-06-11 collapse (see
    // src/config/beacon.ts and content/thoughts/killing-the-bash-daemon.md).
    // Default is "on": when an agent self-reports status:ready, Loki
    // fires the queue head (or the canned next_best template if the queue
    // is empty). Safety rails (status:working/blocked, pending-blocker gate,
    // no-op fuse, health gate) all still apply. Legacy values queue_only |
    // beacon | next_best | strategist were migrated to "on" in the same
    // commit; coerceAutoInjectMode in src/db/queries/beacon-settings.ts
    // tolerates them for any row that escapes the UPDATE.
    autoInjectMode: text("auto_inject_mode").notNull().default("on"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_beacon_settings_user_id").on(t.userId)],
);

export type BeaconSettingsRow = typeof beaconSettings.$inferSelect;
export type NewBeaconSettingsRow = typeof beaconSettings.$inferInsert;
