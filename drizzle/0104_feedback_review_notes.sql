ALTER TABLE "site_feedback" ADD COLUMN "requires_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site_feedback" ADD COLUMN "capture_context" jsonb;