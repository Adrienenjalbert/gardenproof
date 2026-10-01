/**
 * Week planner: the next 7 days' dated jobs — site visits, start dates, maintenance visits — grouped by day,
 * so the owner can see the week at a glance. Jobs on site with no exact finish date are listed separately,
 * not slotted into a day. Server-only, scoped to the current tenant.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Job } from "@/db/schema";
import type { CrmStage } from "@/lib/crm";
import { serviceLabel, type TenantConfig } from "@/lib/tenant";
import { getTenantBySlug } from "@/lib/tenants";
import { stageSince } from "./jobs";
import { calendarDaysBetween, clockTime, dayHeading } from "./words";

const DAY = 86_400_000;
const DATED_STAGES: CrmStage[] = ["site_visit", "booked", "maintenance"];

export type PlannerItem = {
  jobId: string;
  /** "10:00", or null when the date carries no particular time. */
  time: string | null;
  name: string;
  area: string | null;
  service: string | null;
  stage: CrmStage;
  team: string;
};

export type PlannerDay = {
  key: string;
  heading: string;
  isToday: boolean;
  items: PlannerItem[];
};

export type OnSiteJob = {
  jobId: string;
  name: string;
  area: string | null;
  team: string;
  day: number;
};

export type WeekPlanner = {
  days: PlannerDay[];
  onSite: OnSiteJob[];
};

export async function getWeekPlanner(now = new Date()): Promise<WeekPlanner> {
  const tenant = await getTenantBySlug();
  const config = tenant.config as TenantConfig;
  const db = await getDb();
  const T = tenant.id;

  const [jobs, customers, events] = await Promise.all([
    db.select().from(schema.jobs).where(eq(schema.jobs.tenantId, T)),
    db.select().from(schema.customers).where(eq(schema.customers.tenantId, T)),
    db.select().from(schema.jobStageEvents).where(and(eq(schema.jobStageEvents.tenantId, T))),
  ]);
  const cust = new Map(customers.map((c) => [c.id, c]));
  const nameOf = (j: Job) => (j.customerId ? (cust.get(j.customerId)?.firstName ?? null) : null) ?? j.title ?? "A customer";

  const days: PlannerDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * DAY);
    days.push({ key: d.toISOString().slice(0, 10), heading: dayHeading(d, now), isToday: i === 0, items: [] });
  }

  const grace = new Date(now.getTime() - 2 * 3600_000); // a visit that started a moment ago still shows today
  const horizon = new Date(now.getTime() + 7 * DAY);
  for (const j of jobs) {
    if (!j.nextActionAt || !DATED_STAGES.includes(j.stage as CrmStage)) continue;
    if (j.nextActionAt < grace || j.nextActionAt >= horizon) continue;
    const offset = calendarDaysBetween(now, j.nextActionAt);
    const day = days[Math.max(0, Math.min(6, offset))];
    const t = clockTime(j.nextActionAt);
    day.items.push({
      jobId: j.id,
      time: t === "00:00" ? null : t,
      name: nameOf(j),
      area: j.area,
      service: j.service ? serviceLabel(j.service, config) : null,
      stage: j.stage as CrmStage,
      team: j.team,
    });
  }
  for (const day of days) day.items.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

  const onSite: OnSiteJob[] = jobs
    .filter((j) => j.stage === "on_site")
    .map((j) => ({
      jobId: j.id,
      name: nameOf(j),
      area: j.area,
      team: j.team,
      day: calendarDaysBetween(stageSince(j, events), now) + 1,
    }))
    .sort((a, b) => b.day - a.day);

  return { days, onSite };
}
