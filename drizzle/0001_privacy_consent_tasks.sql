CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "attribution" jsonb;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "blurred_key" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "privacy_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "testimonials" ADD COLUMN "consent_quote" boolean;--> statement-breakpoint
ALTER TABLE "testimonials" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_dedupe_uq" ON "tasks" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "tasks_claim_idx" ON "tasks" USING btree ("status","run_at");