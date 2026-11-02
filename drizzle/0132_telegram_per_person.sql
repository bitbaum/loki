ALTER TABLE "notification_preferences" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "telegram_username" text;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "telegram_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "telegram_link_code" text;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "telegram_link_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "telegram_choices" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_notification_preferences_telegram_link_code" ON "notification_preferences" USING btree ("telegram_link_code");