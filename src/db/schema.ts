import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  AssetStatus,
  AssetType,
  CrewRole,
  JobEnrichment,
  JobStatus,
  MediaKind,
  MediaStage,
  MessageStatus,
  Team,
} from "@/lib/domain";
import type { TenantConfig } from "@/lib/tenant";
import type { BusinessProfile } from "@/lib/intel/types";
import type { CrmStage, FormKind, NotificationSettings, TeamRole, TrustTier } from "@/lib/crm";

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const tenants = pgTable("tenants", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** WhatsApp business number this tenant receives on (E.164). */
  whatsappNumber: text("whatsapp_number"),
  config: jsonb("config").$type<TenantConfig>().notNull(),
  /** What we learned from their website + the public web (intel pipeline), confirmed by the owner. */
  profile: jsonb("profile").$type<BusinessProfile>(),
  /** Owner preferences: notifications, trust tiers, directory visibility. */
  settings: jsonb("settings").$type<{ notifications?: NotificationSettings; directory?: { enabled: boolean; slug: string } }>().notNull().default({}),
  createdAt: createdAt(),
});

export const crewMembers = pgTable(
  "crew_members",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    phone: text("phone").notNull(), // E.164
    role: text("role").$type<CrewRole>().notNull().default("crew"),
    team: text("team").$type<Team>().notNull().default("landscaping"),
    /** CRM role (owner / office / crew lead / crew). `role` above is the legacy capture role. */
    teamRole: text("team_role").$type<TeamRole>().notNull().default("crew"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("crew_phone_uq").on(t.tenantId, t.phone)],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text("phone"), // E.164
    email: text("email"),
    postcode: text("postcode"),
    area: text("area"),
    /** Opted out of all messages (STOP). Never message when true. */
    optedOut: boolean("opted_out").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("customers_phone_idx").on(t.tenantId, t.phone)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    code: text("code").notNull(), // short human code, e.g. "TL-4821"
    customerId: text("customer_id").references(() => customers.id),
    status: text("status").$type<JobStatus>().notNull().default("capturing"),
    /** CRM stage (what the owner sees). `status` above is the content-pipeline status. */
    stage: text("stage").$type<CrmStage>().notNull().default("on_site"),
    valueBand: text("value_band"), // e.g. "£10-20k"
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    team: text("team").$type<Team>().notNull().default("landscaping"),
    service: text("service"), // tenant service key
    subServices: text("sub_services").array().notNull().default(sql`'{}'::text[]`),
    postcode: text("postcode"),
    area: text("area"),
    title: text("title"), // internal label, e.g. "Pond & gravel garden, Wimbledon"
    brief: text("brief"), // crew voice-note transcript / notes
    enrichment: jsonb("enrichment").$type<JobEnrichment>(),
    createdByCrewId: text("created_by_crew_id").references(() => crewMembers.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("jobs_code_uq").on(t.tenantId, t.code), index("jobs_status_idx").on(t.tenantId, t.status)],
);

export const media = pgTable(
  "media",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    jobId: text("job_id").notNull().references(() => jobs.id),
    stage: text("stage").$type<MediaStage>().notNull(),
    kind: text("kind").$type<MediaKind>().notNull(),
    /** Private original (full res, EXIF kept). Storage key. */
    storageKey: text("storage_key").notNull(),
    /** Public-safe derivative (EXIF stripped, faces/plates blurred). Storage key. */
    publicKey: text("public_key"),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    qualityScore: real("quality_score"), // 0..1
    qualityNotes: text("quality_notes"),
    isHero: boolean("is_hero").notNull().default(false),
    transcript: text("transcript"), // for audio voice notes
    /** Blurred derivative (faces / plates / house numbers). Set only by a real blur step. */
    blurredKey: text("blurred_key"),
    /** Operator confirmed this image is safe to publish (checked for faces, plates, house numbers). */
    privacyClearedAt: timestamp("privacy_cleared_at", { withTimezone: true }),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    sourceMessageId: text("source_message_id"),
    createdAt: createdAt(),
  },
  (t) => [index("media_job_idx").on(t.jobId)],
);

export const testimonials = pgTable(
  "testimonials",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    jobId: text("job_id").notNull().references(() => jobs.id),
    customerId: text("customer_id").references(() => customers.id),
    /** Unguessable token for the homeowner review link (/r/[token]). */
    token: text("token").notNull().unique(),
    status: text("status").$type<"pending" | "sent" | "responded" | "expired">().notNull().default("pending"),
    rating: integer("rating"),
    quote: text("quote"),
    consentPhotos: boolean("consent_photos"),
    consentArea: boolean("consent_area"),
    consentFirstName: boolean("consent_first_name"),
    /** Permission to publish the written quote (separate from photos / name / area). */
    consentQuote: boolean("consent_quote"),
    /** Homeowner withdrew consent after responding; everything public must be taken down. */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    /** Exact consent wording shown to the homeowner (UK GDPR evidence). */
    consentWording: text("consent_wording"),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    maintenanceInterest: boolean("maintenance_interest"),
    reviewLinkClicked: text("review_link_clicked"), // "google" | "which" | null
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("testimonials_job_idx").on(t.jobId)],
);

/** WhatsApp conversation state per phone number (crew or customer). */
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    phone: text("phone").notNull(),
    role: text("role").$type<"crew" | "customer" | "unknown">().notNull(),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    activeJobId: text("active_job_id").references(() => jobs.id),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("conversations_phone_uq").on(t.tenantId, t.phone)],
);

/** Every inbound and outbound message. Outbound to customers is "held" in safe mode until approved. */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    conversationId: text("conversation_id").references(() => conversations.id),
    direction: text("direction").$type<"in" | "out">().notNull(),
    channel: text("channel").$type<"whatsapp" | "sms" | "simulator">().notNull().default("simulator"),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    body: text("body"),
    mediaUrls: jsonb("media_urls").$type<string[]>().notNull().default([]),
    /** Interactive options shown with the message (quick replies / list). */
    options: jsonb("options").$type<{ id: string; title: string }[]>().notNull().default([]),
    status: text("status").$type<MessageStatus>().notNull().default("queued"),
    providerId: text("provider_id"), // Twilio SID etc. Used for idempotency.
    /** Typed links, e.g. { testimonialId, jobId, template }. */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_conv_idx").on(t.conversationId),
    uniqueIndex("messages_provider_uq").on(t.providerId),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    jobId: text("job_id").references(() => jobs.id), // null for multi-job assets (area articles)
    type: text("type").$type<AssetType>().notNull(),
    status: text("status").$type<AssetStatus>().notNull().default("draft"),
    title: text("title").notNull(),
    /** Typed by `type` — see ASSET_CONTENT_SCHEMAS in lib/domain.ts */
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    /** Rendered file (video mp4, image) storage key, if any. */
    fileKey: text("file_key"),
    thumbnailKey: text("thumbnail_key"),
    version: integer("version").notNull().default(1),
    /** Automated quality checks (lint) result. */
    checks: jsonb("checks").$type<{ id: string; ok: boolean; message: string }[]>().notNull().default([]),
    reviewNotes: text("review_notes"),
    externalId: text("external_id"), // WordPress post id, etc.
    externalUrl: text("external_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("assets_job_idx").on(t.jobId), index("assets_status_idx").on(t.tenantId, t.status)],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    source: text("source"), // utm_source or inferred (google, facebook, direct, referral)
    medium: text("medium"),
    campaign: text("campaign"),
    content: text("content"), // utm_content — carries asset id / creative variant
    term: text("term"),
    gclid: text("gclid"),
    fbclid: text("fbclid"),
    landingPage: text("landing_page"),
    referrer: text("referrer"),
    projectSlug: text("project_slug"), // portfolio page seen before enquiring
    assetId: text("asset_id").references(() => assets.id),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    postcode: text("postcode"),
    service: text("service"),
    message: text("message"),
    /** Full first- and last-touch attribution: { first: Touch, last: Touch }. */
    attribution: jsonb("attribution").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("leads_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

/** Every CRM stage change (who moved it and why) — drives the job timeline. */
export const jobStageEvents = pgTable(
  "job_stage_events",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    jobId: text("job_id").notNull().references(() => jobs.id),
    fromStage: text("from_stage").$type<CrmStage>(),
    toStage: text("to_stage").$type<CrmStage>().notNull(),
    actor: text("actor").notNull(), // crew id, "owner", "customer", "system"
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("job_stage_events_job_idx").on(t.jobId)],
);

/** Messages planned by the CRM rules (timed to the work). Sent via the task queue + messaging safe mode. */
export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    jobId: text("job_id").references(() => jobs.id),
    customerId: text("customer_id").references(() => customers.id),
    crewId: text("crew_id").references(() => crewMembers.id),
    audience: text("audience").$type<"customer" | "crew" | "owner">().notNull(),
    ruleKey: text("rule_key").notNull(), // e.g. "quote_follow_up"
    trustTier: text("trust_tier").$type<TrustTier>().notNull().default("quick_yes"),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    status: text("status").$type<"scheduled" | "awaiting_approval" | "sent" | "skipped" | "cancelled">().notNull().default("scheduled"),
    reason: text("reason"), // plain-English "why this message" shown to the owner
    body: text("body"),
    messageId: text("message_id").references(() => messages.id),
    createdAt: createdAt(),
  },
  (t) => [index("scheduled_messages_due_idx").on(t.status, t.sendAt), uniqueIndex("scheduled_messages_rule_uq").on(t.jobId, t.ruleKey)],
);

/** Smart forms (enquiry, project brief, review, maintenance visit): saved every step, resumable by token. */
export const formResponses = pgTable(
  "form_responses",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    kind: text("kind").$type<FormKind>().notNull(),
    token: text("token").notNull().unique(),
    customerId: text("customer_id").references(() => customers.id),
    jobId: text("job_id").references(() => jobs.id),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
    step: integer("step").notNull().default(0),
    source: text("source"), // "whatsapp_flow" | "web" | "directory" | utm source
    completedAt: timestamp("completed_at", { withTimezone: true }),
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("form_responses_open_idx").on(t.tenantId, t.completedAt)],
);

/** Website-URL onboarding runs: live progress for the "paste your website" screen, then the draft profile. */
export const onboardingRuns = pgTable("onboarding_runs", {
  id: id(),
  tenantId: text("tenant_id").references(() => tenants.id), // set once the owner confirms
  url: text("url").notNull(),
  status: text("status").$type<"queued" | "running" | "ready" | "confirmed" | "failed">().notNull().default("queued"),
  /** Ordered steps with plain-English labels for the progress UI. */
  steps: jsonb("steps").$type<{ key: string; label: string; status: "pending" | "running" | "done" | "failed"; detail?: string }[]>().notNull().default([]),
  profile: jsonb("profile").$type<BusinessProfile>(),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Durable background tasks (DB-backed queue). Long work (AI generation, video renders, publishing, expiry sweeps)
 * never runs inside a request: handlers enqueue, a worker claims tasks and retries with backoff.
 * dedupeKey is unique while a task is queued/running (cleared on completion) so double clicks don't duplicate work.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    tenantId: text("tenant_id").references(() => tenants.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key"),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("tasks_dedupe_uq").on(t.dedupeKey), index("tasks_claim_idx").on(t.status, t.runAt)],
);

/** Append-only audit log for everything that matters (consent, approvals, publishes, sends). */
export const events = pgTable(
  "events",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    type: text("type").notNull(), // e.g. "job.completed", "asset.approved", "consent.recorded"
    entity: text("entity"),
    entityId: text("entity_id"),
    actor: text("actor"), // crew id, "system", "agency"
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("events_entity_idx").on(t.entity, t.entityId)],
);

export type Tenant = typeof tenants.$inferSelect;
export type CrewMember = typeof crewMembers.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Media = typeof media.$inferSelect;
export type Testimonial = typeof testimonials.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type JobStageEvent = typeof jobStageEvents.$inferSelect;
export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type FormResponse = typeof formResponses.$inferSelect;
export type OnboardingRun = typeof onboardingRuns.$inferSelect;
