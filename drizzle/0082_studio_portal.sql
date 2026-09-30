CREATE TABLE "studio_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"mutation_id" uuid NOT NULL,
	"mutation_hash" text NOT NULL,
	"actor" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"delivery_version" integer,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "studio_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"studio_project_id" uuid NOT NULL,
	"token_id" uuid NOT NULL,
	"request_key_hash" text NOT NULL,
	"access_key_hash" text NOT NULL,
	"intake_hash" text NOT NULL,
	"access_revoked" boolean DEFAULT false NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"changes" text NOT NULL,
	"contact" text,
	"status" text NOT NULL,
	"project_id" uuid,
	"partner_id" uuid,
	"preferred_partner_id" uuid,
	"offer_snapshot" jsonb,
	"delivery_version" integer DEFAULT 0 NOT NULL,
	"preview_url" text,
	"scope" text,
	"delivery_summary" text,
	"approved_version" integer,
	"preview_accepted_at" timestamp with time zone,
	"assessment" jsonb,
	"course_passed_at" timestamp with time zone,
	"partner_approved_at" timestamp with time zone,
	"proposed_profile" jsonb,
	"profile_consent_at" timestamp with time zone,
	"profile_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "studio_request_events" ADD CONSTRAINT "studio_request_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "studio_request_events" ADD CONSTRAINT "studio_request_events_request_id_studio_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."studio_requests"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "studio_requests" ADD CONSTRAINT "studio_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "studio_requests" ADD CONSTRAINT "studio_requests_studio_project_id_entities_id_fk" FOREIGN KEY ("studio_project_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "studio_requests" ADD CONSTRAINT "studio_requests_token_id_widget_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."widget_tokens"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "studio_requests" ADD CONSTRAINT "studio_requests_project_id_entities_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "studio_requests" ADD CONSTRAINT "studio_requests_partner_id_studio_requests_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."studio_requests"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "studio_requests" ADD CONSTRAINT "studio_requests_preferred_partner_id_studio_requests_id_fk" FOREIGN KEY ("preferred_partner_id") REFERENCES "public"."studio_requests"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "studio_request_mutation" ON "studio_request_events" USING btree ("request_id","mutation_id");
--> statement-breakpoint
CREATE INDEX "studio_request_history" ON "studio_request_events" USING btree ("request_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "studio_request_key" ON "studio_requests" USING btree ("user_id","request_key_hash");
--> statement-breakpoint
CREATE INDEX "studio_request_owner" ON "studio_requests" USING btree ("user_id","updated_at");
--> statement-breakpoint
CREATE INDEX "studio_request_partner" ON "studio_requests" USING btree ("partner_id");
