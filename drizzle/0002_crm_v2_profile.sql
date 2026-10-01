CREATE TABLE "form_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"token" text NOT NULL,
	"customer_id" text,
	"job_id" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"source" text,
	"completed_at" timestamp with time zone,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_responses_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "job_stage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"job_id" text NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"actor" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"url" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"profile" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"job_id" text,
	"customer_id" text,
	"crew_id" text,
	"audience" text NOT NULL,
	"rule_key" text NOT NULL,
	"trust_tier" text DEFAULT 'quick_yes' NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"reason" text,
	"body" text,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crew_members" ADD COLUMN "team_role" text DEFAULT 'crew' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "stage" text DEFAULT 'on_site' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "value_band" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "next_action_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "profile" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stage_events" ADD CONSTRAINT "job_stage_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stage_events" ADD CONSTRAINT "job_stage_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_runs" ADD CONSTRAINT "onboarding_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_crew_id_crew_members_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crew_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_responses_open_idx" ON "form_responses" USING btree ("tenant_id","completed_at");--> statement-breakpoint
CREATE INDEX "job_stage_events_job_idx" ON "job_stage_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "scheduled_messages_due_idx" ON "scheduled_messages" USING btree ("status","send_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_messages_rule_uq" ON "scheduled_messages" USING btree ("job_id","rule_key");