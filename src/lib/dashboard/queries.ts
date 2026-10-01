/**
 * Read models for the agency dashboard. Server-only: imported by Server Components under app/ops (the agency view).
 * Every query is scoped to the current tenant (Phase 1: the default tenant from env).
 */
import { and, asc, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset, Customer, Job, Lead, Media, Message, Testimonial } from "@/db/schema";
import { env, isDemoAI, isLocalPublishing, isSimulatorMessaging } from "@/lib/config";
import { JOB_STATUSES, type AssetType, type JobStatus } from "@/lib/domain";
import { publicUrl } from "@/lib/storage";
import { serviceLabel, type TenantConfig } from "@/lib/tenant";
import { getTenantBySlug } from "@/lib/tenants";
import { isAuthEnabled } from "./session";
import { consentBlock, type ConsentBlock } from "./consent-state";
import {
  attributedAssetLabel,
  breakdownSentence,
  contentBreakdown,
  leadAssetCandidates,
  leadContentKind,
  parseAttribution,
  type Breakdown,
  type TouchView,
} from "./lead-attribution";
import { consentBlockers, isFromPortfolio, leadSummary, pickCover, qualityFlags, type Check } from "./logic";
import { mediaPrivacy, needsPrivacyDecision, type PrivacyView } from "./media-privacy";
import { summariseBackground, visibleTaskStates, type BackgroundSummary, type TaskState } from "./task-view";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/**
 * `url` is what the dashboard shows the operator: the public-safe copy when one may be used, otherwise the
 * authenticated operator route (never a public /api/media link to a withheld file or an original).
 */
export type MediaView = Media & {
  url: string;
  /** Full-resolution original, operator-only (keeps EXIF). */
  originalUrl: string;
  /** Public URL of the copy public surfaces use, or null when the photo is withheld. */
  publicUrl: string | null;
  privacy: PrivacyView;
  flags: string[];
};

export type JobCard = {
  id: string;
  code: string;
  title: string;
  status: JobStatus;
  service: string | null;
  serviceLabel: string | null;
  area: string | null;
  crewName: string | null;
  coverUrl: string | null;
  coverStage: Media["stage"] | null;
  mediaCount: number;
  /** In-review assets the operator can act on (consent-blocked drafts are counted separately). */
  assetsInReview: number;
  assetsBlocked: number;
  assetsTotal: number;
  updatedAt: Date;
  completedAt: Date | null;
};

async function tenantContext() {
  const tenant = await getTenantBySlug();
  return { db: await getDb(), tenant, config: tenant.config as TenantConfig };
}

/** Authenticated operator route for a media row (see app/ops/media/[id]/route.ts). */
export const operatorMediaUrl = (mediaId: string, original = false) =>
  `/ops/media/${encodeURIComponent(mediaId)}${original ? "?v=original" : ""}`;

function displayUrl(m: Media, privacy = mediaPrivacy(m)): string {
  return privacy.publicKey ? publicUrl(privacy.publicKey) : operatorMediaUrl(m.id);
}

function toMediaView(m: Media): MediaView {
  const privacy = mediaPrivacy(m);
  return {
    ...m,
    url: displayUrl(m, privacy),
    originalUrl: operatorMediaUrl(m.id, true),
    publicUrl: privacy.publicKey ? publicUrl(privacy.publicKey) : null,
    privacy,
    flags: qualityFlags(m),
  };
}

const isConsentBlocked = (a: { checks: Check[] }) => consentBlockers(a.checks).length > 0;

function jobTitle(j: Pick<Job, "title" | "code">): string {
  return j.title ?? `Job ${j.code}`;
}

/** Build job cards for a set of jobs with their media, crew and asset counts in 3 queries. */
async function buildJobCards(jobs: Job[], config: TenantConfig): Promise<JobCard[]> {
  if (!jobs.length) return [];
  const db = await getDb();
  const ids = jobs.map((j) => j.id);
  const [mediaRows, assetRows, crewRows] = await Promise.all([
    db.select().from(schema.media).where(inArray(schema.media.jobId, ids)).orderBy(asc(schema.media.createdAt)),
    db
      .select({ jobId: schema.assets.jobId, status: schema.assets.status, checks: schema.assets.checks })
      .from(schema.assets)
      .where(inArray(schema.assets.jobId, ids)),
    db
      .select({ id: schema.crewMembers.id, name: schema.crewMembers.name })
      .from(schema.crewMembers)
      .where(inArray(schema.crewMembers.id, jobs.map((j) => j.createdByCrewId).filter((x): x is string => !!x))),
  ]);
  const crew = new Map(crewRows.map((c) => [c.id, c.name]));
  return jobs.map((j) => {
    const media = mediaRows.filter((m) => m.jobId === j.id);
    const cover = pickCover(media);
    const assets = assetRows.filter((a) => a.jobId === j.id);
    const inReview = assets.filter((a) => a.status === "in_review");
    return {
      id: j.id,
      code: j.code,
      title: jobTitle(j),
      status: j.status,
      service: j.service,
      serviceLabel: j.service ? serviceLabel(j.service, config) : null,
      area: j.area,
      crewName: j.createdByCrewId ? (crew.get(j.createdByCrewId) ?? null) : null,
      coverUrl: cover ? displayUrl(cover) : null,
      coverStage: cover?.stage ?? null,
      mediaCount: media.length,
      assetsInReview: inReview.filter((a) => !isConsentBlocked(a)).length,
      assetsBlocked: inReview.filter(isConsentBlocked).length,
      assetsTotal: assets.length,
      updatedAt: j.updatedAt,
      completedAt: j.completedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Layout shell
// ---------------------------------------------------------------------------

export type ShellInfo = {
  tenantName: string;
  safeMode: boolean;
  demoAI: boolean;
  simulatorMessaging: boolean;
  localPublishing: boolean;
  authEnabled: boolean;
  reviewCount: number;
  heldCount: number;
};

export async function getShellInfo(): Promise<ShellInfo> {
  const { db, tenant } = await tenantContext();
  const [review, [held]] = await Promise.all([
    db
      .select({ checks: schema.assets.checks })
      .from(schema.assets)
      .where(and(eq(schema.assets.tenantId, tenant.id), eq(schema.assets.status, "in_review"))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .where(and(eq(schema.messages.tenantId, tenant.id), eq(schema.messages.status, "held"))),
  ]);
  return {
    tenantName: tenant.name,
    safeMode: env.safeMode,
    demoAI: isDemoAI(),
    simulatorMessaging: isSimulatorMessaging(),
    localPublishing: isLocalPublishing(),
    authEnabled: isAuthEnabled(),
    // Only drafts the operator can act on: consent-blocked ones are explained per job instead (QA B12).
    reviewCount: review.filter((a) => !isConsentBlocked(a)).length,
    heldCount: held?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Background tasks & consent blocks (shared by overview, job page, review queue)
// ---------------------------------------------------------------------------

export type TaskStateView = TaskState & { jobTitle: string | null; href: string | null };

/**
 * Visible background-task states for the tenant (last 7 days). Renders are labelled with their ratio and every
 * state links to the job it belongs to.
 */
async function loadTaskStates(tenantId: string, scope?: { jobId: string; assetIds: string[] }): Promise<TaskStateView[]> {
  const db = await getDb();
  const since = new Date(Date.now() - 7 * 864e5);
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.tenantId, tenantId),
        gte(schema.tasks.createdAt, since),
        scope
          ? or(
              sql`${schema.tasks.payload}->>'jobId' = ${scope.jobId}`,
              scope.assetIds.length ? inArray(sql<string>`${schema.tasks.payload}->>'assetId'`, scope.assetIds) : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.tasks.createdAt))
    .limit(500);
  const assetIds = [...new Set(rows.map((t) => t.payload.assetId).filter((x): x is string => typeof x === "string"))];
  const assetRows = assetIds.length
    ? await db
        .select({ id: schema.assets.id, jobId: schema.assets.jobId, type: schema.assets.type, content: schema.assets.content })
        .from(schema.assets)
        .where(inArray(schema.assets.id, assetIds))
    : [];
  const ratios = Object.fromEntries(
    assetRows.filter((a) => a.type === "video" && typeof a.content.ratio === "string").map((a) => [a.id, a.content.ratio as string]),
  );
  const states = visibleTaskStates(rows, ratios);
  const assetJob = new Map(assetRows.map((a) => [a.id, a.jobId]));
  const jobIds = [...new Set(states.map((s) => s.jobId ?? (s.assetId ? assetJob.get(s.assetId) : null)).filter((x): x is string => !!x))];
  const jobs = jobIds.length
    ? await db.select({ id: schema.jobs.id, title: schema.jobs.title, code: schema.jobs.code }).from(schema.jobs).where(inArray(schema.jobs.id, jobIds))
    : [];
  return states.map((st) => {
    const jobId = st.jobId ?? (st.assetId ? (assetJob.get(st.assetId) ?? null) : null);
    const job = jobs.find((j) => j.id === jobId);
    return {
      ...st,
      jobId,
      jobTitle: job ? jobTitle(job) : null,
      href: jobId ? `/ops/jobs/${jobId}?tab=assets${st.assetId ? `#asset-${st.assetId}` : ""}` : null,
    };
  });
}

export type BlockedJob = { jobId: string; jobTitle: string; jobCode: string; count: number; block: ConsentBlock };

/** One plain-English explanation per job whose in-review drafts are blocked on consent. */
async function loadConsentBlocks(
  tenantId: string,
  blocked: { jobId: string | null; checks: Check[] }[],
  held: HeldMessageView[],
): Promise<BlockedJob[]> {
  const byJob = new Map<string, Check[]>();
  for (const a of blocked) {
    if (!a.jobId) continue;
    byJob.set(a.jobId, [...(byJob.get(a.jobId) ?? []), ...consentBlockers(a.checks)]);
  }
  if (!byJob.size) return [];
  const db = await getDb();
  const ids = [...byJob.keys()];
  const [jobs, testimonials] = await Promise.all([
    db.select().from(schema.jobs).where(and(eq(schema.jobs.tenantId, tenantId), inArray(schema.jobs.id, ids))),
    db.select().from(schema.testimonials).where(inArray(schema.testimonials.jobId, ids)).orderBy(desc(schema.testimonials.createdAt)),
  ]);
  const customerIds = jobs.map((j) => j.customerId).filter((x): x is string => !!x);
  const customers = customerIds.length
    ? await db.select().from(schema.customers).where(inArray(schema.customers.id, customerIds))
    : [];
  return jobs.map((j) => {
    const checks = byJob.get(j.id) ?? [];
    const c = customers.find((x) => x.id === j.customerId);
    const t = testimonials.find((x) => x.jobId === j.id);
    return {
      jobId: j.id,
      jobTitle: jobTitle(j),
      jobCode: j.code,
      count: blocked.filter((a) => a.jobId === j.id).length,
      block: consentBlock({
        jobId: j.id,
        customer: c ? { firstName: c.firstName, optedOut: c.optedOut } : null,
        testimonial: t ? { status: t.status, consentPhotos: t.consentPhotos, withdrawnAt: t.withdrawnAt } : null,
        requestHeld: held.some((m) => m.jobId === j.id || m.meta.jobId === j.id),
        failedChecks: checks.map((x) => x.message),
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type ReviewGroup = { jobId: string | null; jobTitle: string; jobCode: string | null; count: number; types: AssetType[] };
export type HeldMessageView = Message & { recipientName: string | null; jobId: string | null; jobTitle: string | null };
export type FlaggedMedia = MediaView & { jobTitle: string; jobCode: string };

export type Overview = {
  counts: { jobsThisMonth: number; assetsInReview: number; repliesPending: number; heldMessages: number };
  pipeline: { status: JobStatus; count: number }[];
  reviewGroups: ReviewGroup[];
  blockedJobs: BlockedJob[];
  held: HeldMessageView[];
  flaggedMedia: FlaggedMedia[];
  background: BackgroundSummary<TaskStateView> & { active: TaskStateView[] };
  recentJobs: JobCard[];
};

export async function getOverview(now = new Date()): Promise<Overview> {
  const { db, tenant, config } = await tenantContext();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [jobs, reviewAssets, testimonials, held, mediaRows, tasks] = await Promise.all([
    db.select().from(schema.jobs).where(eq(schema.jobs.tenantId, tenant.id)).orderBy(desc(schema.jobs.updatedAt)),
    db
      .select({ id: schema.assets.id, jobId: schema.assets.jobId, type: schema.assets.type, checks: schema.assets.checks })
      .from(schema.assets)
      .where(and(eq(schema.assets.tenantId, tenant.id), eq(schema.assets.status, "in_review"))),
    db
      .select({ status: schema.testimonials.status })
      .from(schema.testimonials)
      .where(eq(schema.testimonials.tenantId, tenant.id)),
    getHeldMessages(),
    db.select().from(schema.media).where(and(eq(schema.media.tenantId, tenant.id), eq(schema.media.kind, "image"))),
    loadTaskStates(tenant.id),
  ]);

  const actionable = reviewAssets.filter((a) => !isConsentBlocked(a));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const groups = new Map<string, ReviewGroup>();
  for (const a of actionable) {
    const key = a.jobId ?? "_none";
    const job = a.jobId ? jobById.get(a.jobId) : undefined;
    const g = groups.get(key) ?? {
      jobId: a.jobId,
      jobTitle: job ? jobTitle(job) : "Multi-job content",
      jobCode: job?.code ?? null,
      count: 0,
      types: [],
    };
    g.count++;
    if (!g.types.includes(a.type)) g.types.push(a.type);
    groups.set(key, g);
  }

  const flaggedMedia = mediaRows.filter(needsPrivacyDecision).map((m) => {
    const job = jobById.get(m.jobId);
    return { ...toMediaView(m), jobTitle: job ? jobTitle(job) : m.jobId, jobCode: job?.code ?? "" };
  });

  return {
    counts: {
      jobsThisMonth: jobs.filter((j) => j.completedAt && j.completedAt >= monthStart).length,
      assetsInReview: actionable.length,
      repliesPending: testimonials.filter((t) => t.status === "pending" || t.status === "sent").length,
      heldMessages: held.length,
    },
    pipeline: JOB_STATUSES.map((status) => ({ status, count: jobs.filter((j) => j.status === status).length })),
    reviewGroups: [...groups.values()].sort((a, b) => b.count - a.count),
    blockedJobs: await loadConsentBlocks(tenant.id, reviewAssets.filter(isConsentBlocked), held),
    held: held.slice(0, 5),
    flaggedMedia,
    background: { ...summariseBackground(tasks), active: tasks.filter((t) => t.status !== "failed") },
    recentJobs: await buildJobCards(jobs.slice(0, 6), config),
  };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobFilters = { status?: string; service?: string; area?: string };

export async function listJobs(filters: JobFilters = {}): Promise<{
  jobs: JobCard[];
  facets: { services: { key: string; label: string }[]; areas: string[] };
}> {
  const { db, tenant, config } = await tenantContext();
  const all = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.tenantId, tenant.id))
    .orderBy(desc(schema.jobs.updatedAt));

  const filtered = all.filter(
    (j) =>
      (!filters.status || j.status === filters.status) &&
      (!filters.service || j.service === filters.service) &&
      (!filters.area || j.area === filters.area),
  );
  const serviceKeys = [...new Set(all.map((j) => j.service).filter((s): s is string => !!s))];
  return {
    jobs: await buildJobCards(filtered, config),
    facets: {
      services: serviceKeys.map((key) => ({ key, label: serviceLabel(key, config) })),
      areas: [...new Set(all.map((j) => j.area).filter((a): a is string => !!a))].sort(),
    },
  };
}

export type JobDetail = {
  job: Job;
  card: JobCard;
  customer: Pick<Customer, "firstName" | "lastName" | "postcode" | "area" | "optedOut"> | null;
  media: MediaView[];
  testimonial: Testimonial | null;
  assets: Asset[];
  events: { id: string; type: string; actor: string | null; createdAt: Date; data: Record<string, unknown> }[];
  /** Consent-related audit entries (recorded, withdrawn, changed), newest first. */
  consentEvents: { id: string; type: string; actor: string | null; createdAt: Date; data: Record<string, unknown> }[];
  /** Background work for this job and its assets. */
  tasks: TaskStateView[];
  /** Set when in-review drafts are blocked on consent, or no homeowner is attached yet. */
  consent: ConsentBlock | null;
  tenantConfig: TenantConfig;
};

export async function getJobDetail(jobId: string): Promise<JobDetail | null> {
  const { db, tenant, config } = await tenantContext();
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.tenantId, tenant.id)));
  if (!job) return null;

  const jobEvents = and(
    eq(schema.events.tenantId, tenant.id),
    or(
      and(eq(schema.events.entity, "job"), eq(schema.events.entityId, jobId)),
      sql`${schema.events.data}->>'jobId' = ${jobId}`,
    ),
  );
  const [mediaRows, testimonials, assets, customerRows, events, consentEvents, [card], held] = await Promise.all([
    db.select().from(schema.media).where(eq(schema.media.jobId, jobId)).orderBy(asc(schema.media.createdAt)),
    db
      .select()
      .from(schema.testimonials)
      .where(eq(schema.testimonials.jobId, jobId))
      .orderBy(desc(schema.testimonials.createdAt)),
    db.select().from(schema.assets).where(eq(schema.assets.jobId, jobId)).orderBy(asc(schema.assets.createdAt)),
    job.customerId
      ? db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId))
      : Promise.resolve([] as Customer[]),
    db.select().from(schema.events).where(jobEvents).orderBy(desc(schema.events.createdAt)).limit(20),
    db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.tenantId, tenant.id),
          or(like(schema.events.type, "consent.%"), like(schema.events.type, "testimonial.%")),
          or(
            sql`${schema.events.data}->>'jobId' = ${jobId}`,
            and(eq(schema.events.entity, "job"), eq(schema.events.entityId, jobId)),
          ),
        ),
      )
      .orderBy(desc(schema.events.createdAt))
      .limit(20),
    buildJobCards([job], config),
    getHeldMessages(),
  ]);
  const c = customerRows[0];
  const t = testimonials[0] ?? null;
  const blocked = assets.filter((a) => a.status === "in_review" && isConsentBlocked(a));
  const consent =
    blocked.length || !c
      ? consentBlock({
          jobId,
          customer: c ? { firstName: c.firstName, optedOut: c.optedOut } : null,
          testimonial: t ? { status: t.status, consentPhotos: t.consentPhotos, withdrawnAt: t.withdrawnAt } : null,
          requestHeld: held.some((m) => m.jobId === jobId || m.meta.jobId === jobId),
          failedChecks: blocked.flatMap((a) => consentBlockers(a.checks).map((x) => x.message)),
        })
      : null;
  const pick = (e: typeof events) =>
    e.map((x) => ({ id: x.id, type: x.type, actor: x.actor, createdAt: x.createdAt, data: x.data }));
  return {
    job,
    card,
    customer: c
      ? { firstName: c.firstName, lastName: c.lastName, postcode: c.postcode, area: c.area, optedOut: c.optedOut }
      : null,
    media: mediaRows.map(toMediaView),
    testimonial: t,
    assets,
    events: pick(events),
    consentEvents: pick(consentEvents),
    tasks: await loadTaskStates(tenant.id, { jobId, assetIds: assets.map((a) => a.id) }),
    consent,
    tenantConfig: config,
  };
}

/** Media lookup for asset previews (carousel strips, GBP image, before/after). */
export async function getMediaUrls(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const db = await getDb();
  const rows = await db.select().from(schema.media).where(inArray(schema.media.id, ids));
  return Object.fromEntries(rows.map((m) => [m.id, displayUrl(m)]));
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

export type ReviewItem = Asset & { jobTitle: string; jobCode: string | null; coverUrl: string | null };

/**
 * Actionable drafts (checks may fail, but consent doesn't block them), plus one explanation per job whose drafts
 * are blocked on consent — those are not "waiting for you" (QA B12).
 */
export async function getReviewQueue(): Promise<{ items: ReviewItem[]; blocked: BlockedJob[] }> {
  const { db, tenant, config } = await tenantContext();
  const assets = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.tenantId, tenant.id), eq(schema.assets.status, "in_review")))
    .orderBy(asc(schema.assets.jobId), asc(schema.assets.createdAt));
  const actionable = assets.filter((a) => !isConsentBlocked(a));
  const jobIds = [...new Set(actionable.map((a) => a.jobId).filter((x): x is string => !!x))];
  const jobs = jobIds.length ? await db.select().from(schema.jobs).where(inArray(schema.jobs.id, jobIds)) : [];
  const cards = new Map((await buildJobCards(jobs, config)).map((c) => [c.id, c]));
  const items = actionable.map((a) => {
    const card = a.jobId ? cards.get(a.jobId) : undefined;
    return {
      ...a,
      jobTitle: card?.title ?? "Multi-job content",
      jobCode: card?.code ?? null,
      coverUrl: a.thumbnailKey ? publicUrl(a.thumbnailKey) : (card?.coverUrl ?? null),
    };
  });
  const blocked = await loadConsentBlocks(tenant.id, assets.filter(isConsentBlocked), await getHeldMessages());
  return { items, blocked };
}

// ---------------------------------------------------------------------------
// Messages (safe-mode outbox)
// ---------------------------------------------------------------------------

async function decorateMessages(rows: Message[], tenantId: string): Promise<HeldMessageView[]> {
  if (!rows.length) return [];
  const db = await getDb();
  const phones = [...new Set(rows.map((m) => m.toNumber).filter((x): x is string => !!x))];
  const convIds = [...new Set(rows.map((m) => m.conversationId).filter((x): x is string => !!x))];
  const [customers, crew, convs] = await Promise.all([
    phones.length
      ? db
          .select()
          .from(schema.customers)
          .where(and(eq(schema.customers.tenantId, tenantId), inArray(schema.customers.phone, phones)))
      : [],
    phones.length
      ? db
          .select()
          .from(schema.crewMembers)
          .where(and(eq(schema.crewMembers.tenantId, tenantId), inArray(schema.crewMembers.phone, phones)))
      : [],
    convIds.length ? db.select().from(schema.conversations).where(inArray(schema.conversations.id, convIds)) : [],
  ]);
  const jobIds = [...new Set(convs.map((c) => c.activeJobId).filter((x): x is string => !!x))];
  const customerIds = customers.map((c) => c.id);
  const jobs =
    jobIds.length || customerIds.length
      ? await db
          .select()
          .from(schema.jobs)
          .where(
            and(
              eq(schema.jobs.tenantId, tenantId),
              or(
                jobIds.length ? inArray(schema.jobs.id, jobIds) : undefined,
                customerIds.length ? inArray(schema.jobs.customerId, customerIds) : undefined,
              ),
            ),
          )
          .orderBy(desc(schema.jobs.updatedAt))
      : [];
  return rows.map((m) => {
    const cust = customers.find((c) => c.phone === m.toNumber);
    const member = crew.find((c) => c.phone === m.toNumber);
    const conv = convs.find((c) => c.id === m.conversationId);
    // Prefer the conversation's active job; otherwise the customer's most recent job.
    const job =
      jobs.find((j) => j.id === conv?.activeJobId) ?? (cust ? jobs.find((j) => j.customerId === cust.id) : undefined);
    const name = cust ? [cust.firstName, cust.lastName].filter(Boolean).join(" ") : (member?.name ?? null);
    return { ...m, recipientName: name || null, jobId: job?.id ?? null, jobTitle: job ? jobTitle(job) : null };
  });
}

export async function getHeldMessages(): Promise<HeldMessageView[]> {
  const { db, tenant } = await tenantContext();
  const rows = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.tenantId, tenant.id), eq(schema.messages.status, "held")))
    .orderBy(asc(schema.messages.createdAt));
  return decorateMessages(rows, tenant.id);
}

export async function getRecentOutbound(limit = 25): Promise<HeldMessageView[]> {
  const { db, tenant } = await tenantContext();
  const rows = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.tenantId, tenant.id),
        eq(schema.messages.direction, "out"),
        inArray(schema.messages.status, ["sent", "approved", "failed", "cancelled"]),
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit);
  return decorateMessages(rows, tenant.id);
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export type LeadView = Lead & {
  fromPortfolio: boolean;
  project: { assetId: string; title: string; previewUrl: string } | null;
  /** The content this enquiry is credited to (any asset type), via assetId or utm_content. */
  attributed: { assetId: string; type: AssetType; label: string; jobId: string | null } | null;
  firstTouch: TouchView | null;
  lastTouch: TouchView | null;
};

export async function getLeads(days = 90, now = new Date()): Promise<{
  leads: LeadView[];
  summary: ReturnType<typeof leadSummary>;
  breakdown: Breakdown;
  breakdownText: string;
}> {
  const { db, tenant } = await tenantContext();
  const since = new Date(now.getTime() - days * 864e5);
  const rows = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.tenantId, tenant.id), gte(schema.leads.createdAt, since)))
    .orderBy(desc(schema.leads.createdAt));
  const candidates = [...new Set(rows.flatMap(leadAssetCandidates))];
  const [attributedAssets, pages] = await Promise.all([
    candidates.length
      ? db
          .select({ id: schema.assets.id, type: schema.assets.type, title: schema.assets.title, content: schema.assets.content, jobId: schema.assets.jobId })
          .from(schema.assets)
          .where(and(eq(schema.assets.tenantId, tenant.id), inArray(schema.assets.id, candidates)))
      : Promise.resolve([]),
    db
      .select({ id: schema.assets.id, title: schema.assets.title, content: schema.assets.content, jobId: schema.assets.jobId })
      .from(schema.assets)
      .where(and(eq(schema.assets.tenantId, tenant.id), eq(schema.assets.type, "portfolio_page"))),
  ]);
  const leads = rows.map((l) => {
    const asset = leadAssetCandidates(l)
      .map((id) => attributedAssets.find((a) => a.id === id))
      .find((a) => a !== undefined);
    // The project page they saw: the attributed page itself, the slug they browsed, or the page for the
    // attributed video/ad's job.
    const page =
      (asset?.type === "portfolio_page" ? pages.find((p) => p.id === asset.id) : undefined) ??
      (l.projectSlug ? pages.find((p) => (p.content as { slug?: string }).slug === l.projectSlug) : undefined) ??
      (asset?.jobId ? pages.find((p) => p.jobId === asset.jobId) : undefined);
    const touches = parseAttribution(l.attribution);
    return {
      ...l,
      fromPortfolio: isFromPortfolio(l) || !!page,
      project: page ? { assetId: page.id, title: page.title, previewUrl: `/preview/${page.id}` } : null,
      attributed: asset ? { assetId: asset.id, type: asset.type, label: attributedAssetLabel(asset), jobId: asset.jobId } : null,
      firstTouch: touches.first,
      lastTouch: touches.last,
    };
  });
  const breakdown = contentBreakdown(leads.map((l) => leadContentKind(l.attributed?.type ?? null, l.fromPortfolio)));
  return { leads, summary: leadSummary(rows), breakdown, breakdownText: breakdownSentence(breakdown) };
}
