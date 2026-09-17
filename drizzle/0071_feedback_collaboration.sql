CREATE TABLE "project_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_project_memberships_project_user" UNIQUE("project_id", "user_id"),
  CONSTRAINT "project_memberships_project_id_entities_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."entities"("id") ON DELETE cascade,
  CONSTRAINT "project_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "idx_project_memberships_user" ON "project_memberships" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "site_feedback" ADD COLUMN "reporter_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "site_feedback" ADD CONSTRAINT "site_feedback_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "idx_site_feedback_reporter" ON "site_feedback" USING btree ("reporter_user_id", "created_at");
