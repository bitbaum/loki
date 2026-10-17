CREATE TABLE "npm_publish_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"sealed" text NOT NULL,
	"npm_user" text,
	"expires_at" timestamp with time zone,
	"attempts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "npm_publish_keys" ADD CONSTRAINT "npm_publish_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;