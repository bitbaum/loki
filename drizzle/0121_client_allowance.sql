ALTER TABLE "project_invitations" ADD COLUMN "monthly_changes" integer;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD COLUMN "monthly_changes" integer;--> statement-breakpoint
ALTER TABLE "site_feedback" ADD COLUMN "on_allowance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site_feedback" ADD COLUMN "live_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_feedback" ADD COLUMN "live_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "site_feedback" ADD CONSTRAINT "site_feedback_live_approved_by_users_id_fk" FOREIGN KEY ("live_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;