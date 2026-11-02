import { pgTable, uuid, text, timestamp, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import type { NotifyChoices } from "@/config/notify-categories";
import { users } from "./users";

// Per-user opt-in for periodic digest emails. One row per user. Absence of a
// row is equivalent to cadence="none" — we never spam an account that hasn't
// explicitly opted in.

export const DIGEST_CADENCES = ["none", "daily", "weekly", "monthly"] as const;
export type DigestCadence = (typeof DIGEST_CADENCES)[number];

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emailDigestCadence: text("email_digest_cadence")
      .$type<DigestCadence>()
      .notNull()
      .default("none"),
    lastDigestSentAt: timestamp("last_digest_sent_at", { withTimezone: true }),
    // Telegram, per person (2026-11-02). The chat the person linked by tapping
    // Start in Loki's bot — never typed, never guessed. Null = not linked.
    telegramChatId: text("telegram_chat_id"),
    telegramUsername: text("telegram_username"),
    telegramLinkedAt: timestamp("telegram_linked_at", { withTimezone: true }),
    // A one-time code in the t.me/<bot>?start=<code> link, and when it expires.
    telegramLinkCode: text("telegram_link_code"),
    telegramLinkExpiresAt: timestamp("telegram_link_expires_at", { withTimezone: true }),
    // Which kinds of message reach Telegram (config/notify-categories.ts).
    // A missing key means that kind's default.
    telegramChoices: jsonb("telegram_choices").$type<NotifyChoices>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_notification_preferences_user_id").on(table.userId),
    uniqueIndex("idx_notification_preferences_telegram_link_code").on(table.telegramLinkCode),
  ],
);

export type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;
