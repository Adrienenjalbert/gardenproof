/** Loads everything the pure reducer needs from the database (see BotContext). */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CrewMember, Customer, Tenant } from "@/db/schema";
import type { Team } from "@/lib/domain";
import { newId, newJobCode } from "@/lib/ids";
import { publicUrl } from "@/lib/storage";
import { serviceLabel, type TenantConfig } from "@/lib/tenant";
import type { BotContext, JobSummary } from "./types";

export async function summariseJobs(jobIds: string[], config: TenantConfig): Promise<JobSummary[]> {
  if (jobIds.length === 0) return [];
  const db = await getDb();
  const jobs = await db.select().from(schema.jobs).where(inArray(schema.jobs.id, jobIds));
  const media = await db
    .select()
    .from(schema.media)
    .where(inArray(schema.media.jobId, jobIds))
    .orderBy(asc(schema.media.createdAt));
  const byId = new Map(
    jobs.map((j) => {
      const own = media.filter((m) => m.jobId === j.id);
      const visual = (stage: string) => own.filter((m) => m.stage === stage && m.kind !== "audio").length;
      // Framing guide goes back to the crew over WhatsApp: only ever the EXIF-stripped copy.
      const firstBefore = own.find((m) => m.stage === "before" && m.kind === "image" && m.publicKey);
      const summary: JobSummary = {
        id: j.id,
        code: j.code,
        service: j.service,
        serviceLabel: j.service ? serviceLabel(j.service, config) : null,
        postcode: j.postcode,
        area: j.area,
        counts: {
          before: visual("before"),
          progress: visual("progress"),
          after: visual("after"),
          audio: own.filter((m) => m.kind === "audio").length,
        },
        firstBeforeUrl: firstBefore?.publicKey ? publicUrl(firstBefore.publicKey) : null,
      };
      return [j.id, summary] as const;
    }),
  );
  return jobIds.map((id) => byId.get(id)).filter((j): j is JobSummary => Boolean(j));
}

/** Services ordered for the crew member's team (maintenance crews see maintenance first). Max 7 = one screen. */
export function servicesFor(config: TenantConfig, team: Team): { key: string; label: string }[] {
  const rank = (key: string) => (team === "maintenance" ? (key === "maintenance" ? 0 : 1) : key === "maintenance" ? 2 : 1);
  return [...config.services]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.key) - rank(b.s.key) || a.i - b.i)
    .slice(0, 7)
    .map(({ s }) => ({ key: s.key, label: s.label }));
}

/**
 * Area shortcuts: the outward codes this tenant works in most (recent jobs + customers) first.
 * Ties break alphabetically: tenants.config is jsonb, which does not preserve key order.
 */
export function areasFor(config: TenantConfig, recentPostcodes: (string | null)[]): { postcode: string; label: string }[] {
  const freq = new Map<string, number>();
  for (const pc of recentPostcodes) {
    const out = pc?.toUpperCase().trim().split(/\s+/)[0];
    if (out && config.areas[out]) freq.set(out, (freq.get(out) ?? 0) + 1);
  }
  const seenLabels = new Set<string>();
  return Object.keys(config.areas)
    .map((code) => ({ code, label: config.areas[code], f: freq.get(code) ?? 0 }))
    .sort((a, b) => b.f - a.f || a.label.localeCompare(b.label) || a.code.localeCompare(b.code))
    .filter(({ label }) => {
      // Richmond is TW9 and TW10: one button is enough.
      if (seenLabels.has(label)) return false;
      seenLabels.add(label);
      return true;
    })
    .slice(0, 6)
    .map(({ code, label }) => ({ postcode: code, label }));
}

async function uniqueJobCode(tenantId: string): Promise<string> {
  const db = await getDb();
  for (let i = 0; i < 20; i++) {
    const code = newJobCode();
    const [hit] = await db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.tenantId, tenantId), eq(schema.jobs.code, code)));
    if (!hit) return code;
  }
  throw new Error("Could not allocate a unique job code");
}

export async function loadBotContext(args: {
  tenant: Tenant;
  role: BotContext["role"];
  crew: CrewMember | null;
  customer: Customer | null;
  activeJobId: string | null;
  now: number;
}): Promise<BotContext> {
  const { tenant, role, crew, customer } = args;
  const config = tenant.config;
  const db = await getDb();
  const base = {
    now: args.now,
    role,
    tenantName: tenant.name,
    tenantWebsite: config.website,
    crewName: crew?.name ?? null,
    team: crew?.team ?? ("landscaping" as Team),
    services: [] as BotContext["services"],
    areas: [] as BotContext["areas"],
    openJobs: [] as JobSummary[],
    activeJob: null as JobSummary | null,
    newJob: { id: "", code: "" },
    customerJobCode: null as string | null,
    customerName: customer?.firstName ?? null,
  };

  if (role === "customer" && customer) {
    const [latest] = await db
      .select({ code: schema.jobs.code })
      .from(schema.jobs)
      .where(eq(schema.jobs.customerId, customer.id))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(1);
    return { ...base, customerJobCode: latest?.code ?? null };
  }
  if (role !== "crew") return base;

  const open = await db
    .select({ id: schema.jobs.id, postcode: schema.jobs.postcode })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.tenantId, tenant.id), eq(schema.jobs.status, "capturing")))
    .orderBy(desc(schema.jobs.updatedAt))
    .limit(5);
  const recentJobs = await db
    .select({ postcode: schema.jobs.postcode })
    .from(schema.jobs)
    .where(eq(schema.jobs.tenantId, tenant.id))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(50);
  const recentCustomers = await db
    .select({ postcode: schema.customers.postcode })
    .from(schema.customers)
    .where(eq(schema.customers.tenantId, tenant.id))
    .orderBy(desc(schema.customers.createdAt))
    .limit(50);

  const ids = [...new Set([...(args.activeJobId ? [args.activeJobId] : []), ...open.map((o) => o.id)])];
  const summaries = await summariseJobs(ids, config);
  const openSet = new Set(open.map((o) => o.id));
  // Only a job still being captured can be "active"; a completed one drops out of the conversation.
  let activeJob: JobSummary | null = null;
  if (args.activeJobId) {
    const [j] = await db
      .select({ status: schema.jobs.status })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, args.activeJobId));
    if (j?.status === "capturing") activeJob = summaries.find((s) => s.id === args.activeJobId) ?? null;
  }

  return {
    ...base,
    services: servicesFor(config, base.team),
    areas: areasFor(config, [...recentJobs, ...recentCustomers].map((r) => r.postcode)),
    openJobs: summaries.filter((s) => openSet.has(s.id)),
    activeJob,
    newJob: { id: newId("job"), code: await uniqueJobCode(tenant.id) },
  };
}
