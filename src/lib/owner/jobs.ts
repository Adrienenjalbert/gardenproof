/**
 * Read models for the owner's Jobs tab and job page. Server-only. Everything is scoped to the current tenant
 * and phrased in the owner's words (see ./words.ts).
 */
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type {
  Asset,
  CrewMember,
  Customer,
  Job,
  JobStageEvent,
  Media,
  Message,
  ScheduledMessage,
  Testimonial,
} from "@/db/schema";
import { CRM_STAGES, type CrmStage } from "@/lib/crm";
import { findCrewLead, ruleOf } from "@/lib/crm-engine";
import { serviceLabel, type TenantConfig } from "@/lib/tenant";
import { getTenantBySlug } from "@/lib/tenants";
import { coverOf, photoUrl } from "./photos";
import {
  STAGE_EVENT_WORDS,
  ago,
  capitalise,
  initials,
  jobStatusLine,
  plural,
  prettyPhone,
  when,
  whatsappLink,
} from "./words";

export type JobListItem = {
  id: string;
  name: string;
  area: string | null;
  service: string | null;
  stage: CrmStage;
  statusLine: string;
  photoUrl: string | null;
  initials: string;
  team: Job["team"];
  /** Something is waiting for the owner on this job (a message to OK). */
  needsYou: boolean;
  /** Lower-cased text the search box matches. */
  search: string;
  sortAt: number;
};

type Loaded = {
  jobs: Job[];
  customers: Map<string, Customer>;
  media: Media[];
  events: JobStageEvent[];
  testimonials: Testimonial[];
  scheduled: ScheduledMessage[];
  config: TenantConfig;
};

async function load(tenantId: string, config: TenantConfig, jobIds?: string[]): Promise<Loaded> {
  const db = await getDb();
  const jobs = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.tenantId, tenantId), jobIds ? inArray(schema.jobs.id, jobIds) : undefined))
    .orderBy(desc(schema.jobs.updatedAt));
  const ids = jobs.map((j) => j.id);
  if (!ids.length)
    return {
      jobs,
      customers: new Map(),
      media: [],
      events: [],
      testimonials: [],
      scheduled: [],
      config,
    };
  const custIds = jobs.map((j) => j.customerId).filter((x): x is string => !!x);
  const [customers, media, events, testimonials, scheduled] = await Promise.all([
    custIds.length
      ? db.select().from(schema.customers).where(inArray(schema.customers.id, custIds))
      : Promise.resolve([] as Customer[]),
    db.select().from(schema.media).where(inArray(schema.media.jobId, ids)).orderBy(asc(schema.media.createdAt)),
    db
      .select()
      .from(schema.jobStageEvents)
      .where(inArray(schema.jobStageEvents.jobId, ids))
      .orderBy(asc(schema.jobStageEvents.createdAt)),
    db
      .select()
      .from(schema.testimonials)
      .where(inArray(schema.testimonials.jobId, ids))
      .orderBy(asc(schema.testimonials.createdAt)),
    db
      .select()
      .from(schema.scheduledMessages)
      .where(inArray(schema.scheduledMessages.jobId, ids))
      .orderBy(asc(schema.scheduledMessages.sendAt)),
  ]);
  return {
    jobs,
    customers: new Map(customers.map((c) => [c.id, c])),
    media,
    events,
    testimonials,
    scheduled,
    config,
  };
}

/** When the job entered its current stage (last matching event), else its last update. */
export function stageSince(job: Job, events: JobStageEvent[]): Date {
  const e = events.filter((x) => x.jobId === job.id && x.toStage === job.stage).at(-1);
  return e?.createdAt ?? job.updatedAt;
}

export function displayName(job: Pick<Job, "title" | "code">, c: Customer | undefined): string {
  return c?.firstName?.trim() || job.title || `Job ${job.code}`;
}

function toListItem(job: Job, l: Loaded, now: Date): JobListItem {
  const c = job.customerId ? l.customers.get(job.customerId) : undefined;
  const media = l.media.filter((m) => m.jobId === job.id);
  const cover = coverOf(media);
  const t = l.testimonials.filter((x) => x.jobId === job.id).at(-1);
  const since = stageSince(job, l.events);
  const name = displayName(job, c);
  const service = job.service ? serviceLabel(job.service, l.config) : null;
  const statusLine = jobStatusLine(
    {
      stage: job.stage,
      stageSince: since,
      nextActionAt: job.nextActionAt,
      reviewAsked: !!t && t.status !== "expired",
      reviewRating: t?.status === "responded" ? t.rating : null,
    },
    now,
  );
  return {
    id: job.id,
    name,
    area: job.area,
    service,
    stage: job.stage,
    statusLine,
    photoUrl: cover ? photoUrl(cover) : null,
    initials: initials(c ? `${c.firstName ?? ""} ${c.lastName ?? ""}` : name),
    team: job.team,
    needsYou: l.scheduled.some((s) => s.jobId === job.id && s.status === "awaiting_approval"),
    search: [name, c?.lastName, job.area, service, job.title, job.postcode].filter(Boolean).join(" ").toLowerCase(),
    sortAt: (job.nextActionAt ?? since).getTime(),
  };
}

export async function listOwnerJobs(now = new Date()): Promise<JobListItem[]> {
  const tenant = await getTenantBySlug();
  const l = await load(tenant.id, tenant.config as TenantConfig);
  const items = l.jobs.map((j) => toListItem(j, l, now));
  const order = (s: CrmStage) => CRM_STAGES.indexOf(s);
  // Within a stage: dated things soonest first (visits, starts), everything else most recent first.
  return items.sort(
    (a, b) =>
      order(a.stage) - order(b.stage) ||
      (["site_visit", "booked", "maintenance"].includes(a.stage) ? a.sortAt - b.sortAt : b.sortAt - a.sortAt),
  );
}

// ---------------------------------------------------------------------------
// Job page
// ---------------------------------------------------------------------------

export type TimelineIcon = "flag" | "camera" | "send" | "reply" | "form" | "star" | "page" | "video" | "mic" | "clock";
export type TimelineItem = {
  id: string;
  at: string;
  ago: string;
  icon: TimelineIcon;
  title: string;
  detail?: string;
  photos?: string[];
};

export type NextMessage = {
  id: string;
  label: string;
  to: string;
  body: string;
  reason: string | null;
  whenText: string;
  status: "awaiting_approval" | "scheduled";
  canEdit: boolean;
};

export type OwnerJob = {
  id: string;
  code: string;
  name: string;
  fullName: string;
  area: string | null;
  service: string | null;
  stage: CrmStage;
  statusLine: string;
  valueBand: string | null;
  brief: string | null;
  team: Job["team"];
  crewLead: string | null;
  hero: string | null;
  photos: { id: string; url: string; stage: Media["stage"] }[];
  phone: string | null;
  phonePretty: string | null;
  whatsapp: string | null;
  nextActionAt: string | null;
  next: NextMessage | null;
  laterCount: number;
  timeline: TimelineItem[];
};

const actorWords = (actor: string, crew: Map<string, CrewMember>, customer: string) =>
  actor === "owner" ? "You" : actor === "customer" ? customer : (crew.get(actor)?.name ?? null);

export function nextMessageOf(
  rows: ScheduledMessage[],
  names: { customer: string; crewLead: string | null },
  now: Date,
): { next: NextMessage | null; later: number } {
  const open = rows.filter((r) => r.status === "awaiting_approval" || r.status === "scheduled");
  const sorted = [...open].sort((a, b) =>
    a.status === b.status ? a.sendAt.getTime() - b.sendAt.getTime() : a.status === "awaiting_approval" ? -1 : 1,
  );
  const r = sorted[0];
  if (!r) return { next: null, later: 0 };
  const rule = ruleOf(r.ruleKey);
  const waiting = r.status === "awaiting_approval";
  return {
    next: {
      id: r.id,
      label: rule?.label ?? "Message",
      to: r.audience === "customer" ? names.customer : r.audience === "crew" ? (names.crewLead ?? "Crew lead") : "You",
      body: r.body ?? "",
      reason: r.reason,
      whenText: waiting ? "Waiting for your OK" : capitalise(when(r.sendAt, now)),
      status: waiting ? "awaiting_approval" : "scheduled",
      canEdit: rule?.via !== "review_request",
    },
    later: sorted.length - 1,
  };
}

async function jobMessages(job: Job, customer: Customer | undefined): Promise<Message[]> {
  const db = await getDb();
  const byPhone = customer?.phone
    ? or(eq(schema.messages.toNumber, customer.phone), eq(schema.messages.fromNumber, customer.phone))
    : undefined;
  return db
    .select()
    .from(schema.messages)
    .where(
      and(eq(schema.messages.tenantId, job.tenantId), or(sql`${schema.messages.meta}->>'jobId' = ${job.id}`, byPhone)),
    )
    .orderBy(asc(schema.messages.createdAt));
}

/** The body without its greeting line, so the timeline shows what the message was about. */
export function messageGist(body: string | null): string | undefined {
  if (!body) return undefined;
  return body.replace(/^(Hi|Dear|Hello) [^,\n]*,\s*/i, "").trim() || undefined;
}

function buildTimeline(args: {
  job: Job;
  customerName: string;
  events: JobStageEvent[];
  media: Media[];
  messages: Message[];
  testimonials: Testimonial[];
  assets: Asset[];
  forms: {
    id: string;
    kind: string;
    step: number;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
  crew: Map<string, CrewMember>;
  now: Date;
}): TimelineItem[] {
  const { now, customerName } = args;
  const items: Array<Omit<TimelineItem, "ago" | "at"> & { atDate: Date }> = [];

  for (const e of args.events) {
    const who = actorWords(e.actor, args.crew, customerName);
    items.push({
      id: e.id,
      atDate: e.createdAt,
      icon: "flag",
      title: STAGE_EVENT_WORDS[e.toStage],
      detail: [e.note, who && who !== "You" ? `by ${who}` : null].filter(Boolean).join(" · ") || undefined,
    });
  }

  // Photos grouped per day, the way a crew sends them.
  const byDay = new Map<string, Media[]>();
  for (const m of args.media.filter((x) => x.kind === "image")) {
    const k = m.createdAt.toISOString().slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), m]);
  }
  const crewName = args.job.createdByCrewId
    ? (args.crew.get(args.job.createdByCrewId)?.name ?? "The team")
    : "The team";
  for (const [day, ms] of byDay) {
    const stages = new Set(ms.map((m) => m.stage));
    const what =
      stages.size === 1 ? ({ before: "before", after: "after", progress: "progress" } as const)[ms[0].stage] : null;
    items.push({
      id: `ph_${day}`,
      atDate: ms.at(-1)!.createdAt,
      icon: "camera",
      title: `${crewName} added ${plural(ms.length, what ? `${what} photo` : "photo")}`,
      photos: ms.slice(0, 4).map(photoUrl),
    });
  }
  for (const m of args.media.filter((x) => x.kind === "audio")) {
    items.push({
      id: m.id,
      atDate: m.createdAt,
      icon: "mic",
      title: `Voice note from ${crewName}`,
      detail: m.transcript ?? undefined,
    });
  }

  const crewByPhone = new Map([...args.crew.values()].map((c) => [c.phone, c]));
  for (const m of args.messages) {
    if (m.status === "failed" || m.status === "cancelled") continue; // failures are the agency's to fix
    if ((m.meta as { kind?: string }).kind === "owner_notification") continue;
    const detail = messageGist(m.body);
    if (m.direction === "in") {
      items.push({
        id: m.id,
        atDate: m.createdAt,
        icon: "reply",
        title: `${customerName} replied`,
        detail,
      });
      continue;
    }
    const crew = m.toNumber ? crewByPhone.get(m.toNumber) : undefined;
    if (crew?.teamRole === "owner") continue;
    const who = crew ? crew.name : customerName;
    const title =
      m.status === "held"
        ? `Message to ${who} waiting for your OK`
        : crew
          ? `Note sent to ${who}`
          : `Message sent to ${who}`;
    items.push({ id: m.id, atDate: m.createdAt, icon: "send", title, detail });
  }

  for (const f of args.forms) {
    if (!f.completedAt && f.step === 0) continue; // link sent, not opened yet
    const what = f.kind === "project_brief" ? "project form" : f.kind === "enquiry" ? "enquiry form" : "form";
    items.push({
      id: f.id,
      atDate: f.completedAt ?? f.updatedAt,
      icon: "form",
      title: f.completedAt ? `${customerName} filled in the ${what}` : `${customerName} started the ${what}`,
    });
  }

  for (const t of args.testimonials) {
    if (t.status !== "responded" || !t.respondedAt) continue;
    items.push({
      id: t.id,
      atDate: t.respondedAt,
      icon: "star",
      title: `${customerName} rated the job ${t.rating}★`,
      detail: t.quote ? `“${t.quote}”` : undefined,
    });
  }

  const pages = args.assets.filter((a) => a.type === "portfolio_page");
  for (const a of pages) {
    items.push({
      id: `${a.id}_made`,
      atDate: a.createdAt,
      icon: "page",
      title: "Project page drafted",
    });
    if (a.publishedAt)
      items.push({
        id: `${a.id}_live`,
        atDate: a.publishedAt,
        icon: "page",
        title: "Project page went live",
      });
  }
  const videos = args.assets.filter((a) => a.type === "video" && a.fileKey);
  if (videos.length)
    items.push({
      id: "videos",
      atDate: videos.at(-1)!.updatedAt,
      icon: "video",
      title: `${plural(videos.length, "video")} made`,
    });

  return items
    .sort((a, b) => b.atDate.getTime() - a.atDate.getTime())
    .map(({ atDate, ...rest }) => ({
      ...rest,
      at: atDate.toISOString(),
      ago: ago(atDate, now),
    }));
}

export async function getOwnerJob(jobId: string, now = new Date()): Promise<OwnerJob | null> {
  const tenant = await getTenantBySlug();
  const config = tenant.config as TenantConfig;
  const l = await load(tenant.id, config, [jobId]);
  const job = l.jobs[0];
  if (!job) return null;
  const db = await getDb();
  const customer = job.customerId ? l.customers.get(job.customerId) : undefined;
  const [crewRows, assets, forms, messages, lead] = await Promise.all([
    db.select().from(schema.crewMembers).where(eq(schema.crewMembers.tenantId, tenant.id)),
    db.select().from(schema.assets).where(eq(schema.assets.jobId, jobId)),
    db
      .select({
        id: schema.formResponses.id,
        kind: schema.formResponses.kind,
        step: schema.formResponses.step,
        completedAt: schema.formResponses.completedAt,
        createdAt: schema.formResponses.createdAt,
        updatedAt: schema.formResponses.updatedAt,
      })
      .from(schema.formResponses)
      .where(eq(schema.formResponses.jobId, jobId)),
    jobMessages(job, customer),
    findCrewLead(tenant.id, job.team),
  ]);
  const crew = new Map(crewRows.map((c) => [c.id, c]));
  const item = toListItem(job, l, now);
  const media = l.media.filter((m) => m.kind === "image");
  const cover = coverOf(media);
  const { next, later } = nextMessageOf(l.scheduled, { customer: item.name, crewLead: lead?.name ?? null }, now);

  return {
    id: job.id,
    code: job.code,
    name: item.name,
    fullName: [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || item.name,
    area: job.area,
    service: item.service,
    stage: job.stage,
    statusLine: item.statusLine,
    valueBand: job.valueBand,
    brief: job.brief,
    team: job.team,
    crewLead: lead?.name ?? null,
    hero: cover ? photoUrl(cover) : null,
    photos: media.map((m) => ({ id: m.id, url: photoUrl(m), stage: m.stage })),
    phone: customer?.phone ?? null,
    phonePretty: prettyPhone(customer?.phone),
    whatsapp: customer?.phone && !customer.optedOut ? whatsappLink(customer.phone) : null,
    nextActionAt: job.nextActionAt?.toISOString() ?? null,
    next,
    laterCount: later,
    timeline: buildTimeline({
      job,
      customerName: item.name,
      events: l.events,
      media: l.media,
      messages,
      testimonials: l.testimonials,
      assets,
      forms,
      crew,
      now,
    }),
  };
}
