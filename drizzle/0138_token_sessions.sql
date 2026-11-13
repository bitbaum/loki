-- A browser session opened with an agent's ck_ token: one row per single-use
-- exchange link (src/lib/auth/token-session.ts). New table only.

CREATE TABLE "token_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_token_id" uuid,
	"next_path" text DEFAULT '/' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "token_sessions" ADD CONSTRAINT "token_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_sessions" ADD CONSTRAINT "token_sessions_agent_token_id_agent_tokens_id_fk" FOREIGN KEY ("agent_token_id") REFERENCES "public"."agent_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_token_sessions_code_hash" ON "token_sessions" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_token_sessions_session_id" ON "token_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_token_sessions_user_id" ON "token_sessions" USING btree ("user_id");