CREATE TABLE "build_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"website" text NOT NULL,
	"brief" jsonb NOT NULL,
	"look" jsonb,
	"status" text DEFAULT 'waiting' NOT NULL,
	"project_id" uuid,
	"preview_url" text,
	"access_code" text,
	"note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "build_requests" ADD CONSTRAINT "build_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_requests" ADD CONSTRAINT "build_requests_project_id_entities_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "build_request_user_request" ON "build_requests" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "build_request_status" ON "build_requests" USING btree ("status","created_at");