ALTER TABLE "site_feedback" ADD COLUMN "agent_name" text;--> statement-breakpoint
ALTER TABLE "site_feedback" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_site_feedback_idempotency" ON "site_feedback" USING btree ("project_id","idempotency_key") WHERE "site_feedback"."idempotency_key" IS NOT NULL;