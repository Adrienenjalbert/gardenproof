/**
 * Today: at most a handful of decisions, ranked, each with one obvious action; then a quiet look ahead and back.
 * Pure ranking/grouping lives in ./today-logic.ts (tested); this file only gathers rows.
 */
import { and, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset, Customer, Job } from "@/db/schema";
import { approvalBlockers } from "@/lib/dashboard/logic";
import { serviceLabel, type TenantConfig } from "@/lib/tenant";
import { getOwnerContext } from "./tenant";
import { coverOf, photoUrl } from "./photos";
import { stageSince } from "./jobs";
import {
  groupUpcoming,
  rankCards,
  summariseContentWins,
  type ContentWins,
  type DecisionCard,
  type RecentItem,
  type UpcomingGroup,
} from "./today-logic";
import { ago, greeting, todayLabel, whatsappLink } from "./words";

export type TodayView = {
  greeting: string;
  date: string;
  cards: DecisionCard[];
  upcoming: UpcomingGroup[];
  recent: RecentItem[];
  /** Enquiries the business's own pages and videos brought in lately (null when none). */
  wins: ContentWins | null;
};

const WINS_DAYS = 30;

const DAY = 86_400_000;

export async function getToday(now = new Date()): Promise<TodayView> {
  const { tenant, brand, ownerName } = await getOwnerContext();
  const config = tenant.config as TenantConfig;
  const db = await getDb();
  const T = tenant.id;

  const [jobs, customers, awaiting, pages, reviews, events, crew] = await Promise.all([
    db.select().from(schema.jobs).where(eq(schema.jobs.tenantId, T)),
    db.select().from(schema.customers).where(eq(schema.customers.tenantId, T)),
    db
      .select()
      .from(schema.scheduledMessages)
      .where(and(eq(schema.scheduledMessages.tenantId, T), eq(schema.scheduledMessages.status, "awaiting_approval"))),
    db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.tenantId, T),
          eq(schema.assets.type, "portfolio_page"),
          inArray(schema.assets.status, ["in_review", "published"]),
        ),
      ),
    db
      .select()
      .from(schema.testimonials)
      .where(
        and(
          eq(schema.testimonials.tenantId, T),
          eq(schema.testimonials.status, "responded"),
          gte(schema.testimonials.respondedAt, new Date(now.getTime() - 14 * DAY)),
        ),
      ),
    db.select().from(schema.jobStageEvents).where(eq(schema.jobStageEvents.tenantId, T)),
    db
      .select()
      .from(schema.crewMembers)
      .where(and(eq(schema.crewMembers.tenantId, T), eq(schema.crewMembers.active, true))),
  ]);
  const jobIds = jobs.map((j) => j.id);
  const media = jobIds.length ? await db.select().from(schema.media).where(inArray(schema.media.jobId, jobIds)) : [];
  const cust = new Map<string, Customer>(customers.map((c) => [c.id, c]));
  const jobMap = new Map<string, Job>(jobs.map((j) => [j.id, j]));
  const nameOf = (j: Job | undefined) =>
    (j?.customerId ? cust.get(j.customerId)?.firstName : null) ?? j?.title ?? "A customer";
  const coverFor = (jobId: string | null) => {
    const c = jobId ? coverOf(media.filter((m) => m.jobId === jobId)) : null;
    return c ? photoUrl(c) : null;
  };
  const business = brand.name;

  const enquiries = jobs
    .filter((j) => j.stage === "enquiry" && now.getTime() - stageSince(j, events).getTime() < 7 * DAY)
    .map((j) => {
      const c = j.customerId ? cust.get(j.customerId) : undefined;
      const hello = `Hi ${c?.firstName ?? "there"}, it's ${ownerName ?? "the team"} from ${business}. Thanks for your enquiry — when would suit for a quick call?`;
      return {
        jobId: j.id,
        name: nameOf(j),
        area: j.area,
        service: j.service ? serviceLabel(j.service, config) : null,
        since: stageSince(j, events),
        whatsapp: c?.phone && !c.optedOut ? whatsappLink(c.phone, hello) : null,
        phone: c?.phone ?? null,
      };
    });

  const approvals = awaiting.map((r) => ({
    id: r.id,
    ruleKey: r.ruleKey,
    trustTier: r.trustTier,
    jobId: r.jobId,
    name: nameOf(r.jobId ? jobMap.get(r.jobId) : undefined),
    body: r.body ?? "",
    since: r.sendAt,
    stageSince: r.jobId && jobMap.get(r.jobId) ? stageSince(jobMap.get(r.jobId)!, events) : r.sendAt,
  }));

  const readyPages = pages
    .filter((a: Asset) => a.status === "in_review" && approvalBlockers(a.checks).length === 0)
    .map((a) => ({
      assetId: a.id,
      jobId: a.jobId,
      name: nameOf(a.jobId ? jobMap.get(a.jobId) : undefined),
      photo: coverFor(a.jobId),
      title: a.title,
    }));

  const lowReviews = reviews
    .filter((t) => (t.rating ?? 5) <= 3)
    .map((t) => {
      const c = t.customerId ? cust.get(t.customerId) : undefined;
      return {
        id: t.id,
        jobId: t.jobId,
        name: c?.firstName ?? "A customer",
        rating: t.rating ?? 0,
        phone: c?.phone ?? null,
      };
    });

  const cards = rankCards({
    now,
    enquiries,
    approvals,
    readyPages,
    lowReviews,
    photoFor: coverFor,
  });

  // Coming up: the next week of visits and starts, plus what's on site, by team.
  const weekAhead = jobs.filter(
    (j) =>
      j.stage === "on_site" ||
      (j.nextActionAt &&
        ["site_visit", "booked", "maintenance"].includes(j.stage) &&
        j.nextActionAt.getTime() >= now.getTime() - 2 * 3600_000 &&
        j.nextActionAt.getTime() < now.getTime() + 7 * DAY),
  );
  const leads = new Map(crew.filter((c) => c.teamRole === "crew_lead").map((c) => [c.team, c.name]));
  const upcoming = groupUpcoming(
    weekAhead.map((j) => ({
      jobId: j.id,
      stage: j.stage,
      team: j.team,
      name: nameOf(j),
      area: j.area,
      at: j.nextActionAt,
      since: stageSince(j, events),
    })),
    leads,
    now,
  );

  const recent = await recentActivity(T, now, nameOf, jobMap);
  const wins = await contentWins(T, now, jobMap);
  return {
    greeting: greeting(now, ownerName),
    date: todayLabel(now),
    cards,
    upcoming,
    recent,
    wins,
  };
}

async function contentWins(tenantId: string, now: Date, jobs: Map<string, Job>): Promise<ContentWins | null> {
  const db = await getDb();
  const leads = await db
    .select({ assetId: schema.leads.assetId, projectSlug: schema.leads.projectSlug })
    .from(schema.leads)
    .where(and(eq(schema.leads.tenantId, tenantId), gte(schema.leads.createdAt, new Date(now.getTime() - WINS_DAYS * DAY))));
  if (!leads.length) return null;
  const assets = await db
    .select({ id: schema.assets.id, jobId: schema.assets.jobId, type: schema.assets.type, content: schema.assets.content })
    .from(schema.assets)
    .where(eq(schema.assets.tenantId, tenantId));
  return summariseContentWins({
    leads,
    assets: assets.map((a) => ({
      id: a.id,
      jobId: a.jobId,
      type: a.type,
      slug: a.type === "portfolio_page" ? (((a.content as { slug?: unknown } | null)?.slug as string | undefined) ?? null) : null,
    })),
    jobLabel: (jobId) => (jobId ? (jobs.get(jobId)?.title ?? null) : null),
    days: WINS_DAYS,
  });
}

async function recentActivity(
  tenantId: string,
  now: Date,
  nameOf: (j: Job | undefined) => string,
  jobs: Map<string, Job>,
): Promise<RecentItem[]> {
  const db = await getDb();
  const since = new Date(now.getTime() - 7 * DAY);
  const [reviews, live, sent, stageEvents] = await Promise.all([
    db
      .select()
      .from(schema.testimonials)
      .where(
        and(
          eq(schema.testimonials.tenantId, tenantId),
          eq(schema.testimonials.status, "responded"),
          gte(schema.testimonials.respondedAt, since),
        ),
      ),
    db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.tenantId, tenantId),
          eq(schema.assets.type, "portfolio_page"),
          isNotNull(schema.assets.publishedAt),
          gte(schema.assets.publishedAt, since),
        ),
      ),
    db
      .select()
      .from(schema.scheduledMessages)
      .where(
        and(
          eq(schema.scheduledMessages.tenantId, tenantId),
          eq(schema.scheduledMessages.status, "sent"),
          ne(schema.scheduledMessages.audience, "owner"),
          gte(schema.scheduledMessages.sendAt, since),
          lt(schema.scheduledMessages.sendAt, now),
        ),
      )
      .orderBy(desc(schema.scheduledMessages.sendAt))
      .limit(10),
    db
      .select()
      .from(schema.jobStageEvents)
      .where(
        and(
          eq(schema.jobStageEvents.tenantId, tenantId),
          ne(schema.jobStageEvents.actor, "owner"),
          gte(schema.jobStageEvents.createdAt, since),
          sql`${schema.jobStageEvents.toStage} in ('enquiry', 'booked')`,
        ),
      ),
  ]);
  const items: Array<RecentItem & { t: number }> = [
    ...reviews.map((r) => ({
      id: r.id,
      icon: "star" as const,
      text: `${nameOf(jobs.get(r.jobId))} left a ${r.rating}★ review`,
      when: ago(r.respondedAt!, now),
      href: `/jobs/${r.jobId}`,
      t: r.respondedAt!.getTime(),
    })),
    ...live.map((a) => ({
      id: a.id,
      icon: "page" as const,
      text: `${a.title} went live`,
      when: ago(a.publishedAt!, now),
      href: "/showcase",
      t: a.publishedAt!.getTime(),
    })),
    ...sent.map((s) => ({
      id: s.id,
      icon: "send" as const,
      text: `${s.audience === "crew" ? "Note sent to the team about" : "Message sent to"} ${nameOf(s.jobId ? jobs.get(s.jobId) : undefined)}`,
      when: ago(s.sendAt, now),
      href: s.jobId ? `/jobs/${s.jobId}` : null,
      t: s.sendAt.getTime(),
    })),
    ...stageEvents.map((e) => ({
      id: e.id,
      icon: "flag" as const,
      text:
        e.toStage === "enquiry"
          ? `New enquiry from ${nameOf(jobs.get(e.jobId))}`
          : `${nameOf(jobs.get(e.jobId))} booked in`,
      when: ago(e.createdAt, now),
      href: `/jobs/${e.jobId}`,
      t: e.createdAt.getTime(),
    })),
  ];
  return items
    .sort((a, b) => b.t - a.t)
    .slice(0, 5)
    .map((i): RecentItem => ({
      id: i.id,
      icon: i.icon,
      text: i.text,
      when: i.when,
      href: i.href,
    }));
}
