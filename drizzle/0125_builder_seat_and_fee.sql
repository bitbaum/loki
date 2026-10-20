ALTER TABLE "studio_requests" ADD COLUMN "builder_user_id" uuid;--> statement-breakpoint
ALTER TABLE "studio_requests" ADD COLUMN "fee_amount" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "studio_requests" ADD COLUMN "fee_currency" text;--> statement-breakpoint
ALTER TABLE "studio_requests" ADD COLUMN "fee_service_id" text;--> statement-breakpoint
ALTER TABLE "studio_requests" ADD COLUMN "fee_url" text;--> statement-breakpoint
ALTER TABLE "studio_requests" ADD COLUMN "fee_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "studio_requests" ADD CONSTRAINT "studio_requests_builder_user_id_users_id_fk" FOREIGN KEY ("builder_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_request_fee_service" ON "studio_requests" USING btree ("fee_service_id");