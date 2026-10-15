CREATE TABLE "site_review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"finding" jsonb,
	"image" text,
	"run_id" uuid,
	"fix_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"url" text NOT NULL,
	"paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"token_hash" text NOT NULL,
	"worker_id" text,
	"worker_state" text DEFAULT 'queued' NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"frame" jsonb,
	"coverage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finding_count" integer DEFAULT 0 NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_review_events" ADD CONSTRAINT "site_review_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_review_events" ADD CONSTRAINT "site_review_events_review_id_site_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."site_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_reviews" ADD CONSTRAINT "site_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_reviews" ADD CONSTRAINT "site_reviews_project_id_entities_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_site_review_events_review" ON "site_review_events" USING btree ("review_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_site_reviews_owner_project" ON "site_reviews" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_site_reviews_active" ON "site_reviews" USING btree ("user_id","project_id") WHERE "site_reviews"."status" IN ('queued', 'running', 'paused');