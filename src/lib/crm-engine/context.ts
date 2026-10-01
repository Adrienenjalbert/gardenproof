/** Loads everything a rule needs about a job (one place, so planning and previews agree). */
import { and, desc, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CrewMember, Job, Tenant } from "@/db/schema";
import { serviceLabel, type TenantConfig } from "@/lib/tenant";
import type { RuleContext } from "./rules";
import { readSettings } from "./settings";

/** The owner: v2 team role first, then the v1 capture role. */
export async function findOwner(tenantId: string): Promise<CrewMember | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.crewMembers)
    .where(
      and(
        eq(schema.crewMembers.tenantId, tenantId),
        eq(schema.crewMembers.active, true),
        or(eq(schema.crewMembers.teamRole, "owner"), eq(schema.crewMembers.role, "owner")),
      ),
    );
  return rows.find((r) => r.teamRole === "owner") ?? rows[0] ?? null;
}

/** The crew lead of a team (v2 role), falling back to the v1 foreman. */
export async function findCrewLead(tenantId: string, team: Job["team"]): Promise<CrewMember | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.crewMembers)
    .where(
      and(
        eq(schema.crewMembers.tenantId, tenantId),
        eq(schema.crewMembers.team, team),
        eq(schema.crewMembers.active, true),
      ),
    );
  return rows.find((r) => r.teamRole === "crew_lead") ?? rows.find((r) => r.role === "foreman") ?? null;
}

/** When the job entered its current stage (latest matching stage event), else when it was last touched. */
export async function stageEnteredAt(job: Job): Promise<Date> {
  const db = await getDb();
  const [e] = await db
    .select({ at: schema.jobStageEvents.createdAt })
    .from(schema.jobStageEvents)
    .where(and(eq(schema.jobStageEvents.jobId, job.id), eq(schema.jobStageEvents.toStage, job.stage)))
    .orderBy(desc(schema.jobStageEvents.createdAt))
    .limit(1);
  return e?.at ?? job.updatedAt;
}

export function businessOf(tenant: Tenant, ownerName: string | null): RuleContext["business"] {
  const config = tenant.config as TenantConfig;
  return {
    name: tenant.profile?.name ?? tenant.name,
    ownerName,
    phone: tenant.profile?.contact.phone ?? config.phone ?? null,
  };
}

export async function loadRuleContext(
  job: Job,
  opts: { now: Date; enteredAt?: Date; projectForm?: string | null },
): Promise<RuleContext> {
  const db = await getDb();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, job.tenantId));
  if (!tenant) throw new Error(`Tenant ${job.tenantId} not found`);
  const [customer] = job.customerId
    ? await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId))
    : [];
  const [owner, lead] = await Promise.all([findOwner(job.tenantId), findCrewLead(job.tenantId, job.team)]);
  const config = tenant.config as TenantConfig;
  return {
    now: opts.now,
    stageEnteredAt: opts.enteredAt ?? (await stageEnteredAt(job)),
    job: {
      id: job.id,
      stage: job.stage,
      area: job.area,
      postcode: job.postcode,
      serviceLabel: job.service ? serviceLabel(job.service, config) : null,
      nextActionAt: job.nextActionAt,
    },
    customer: customer
      ? {
          id: customer.id,
          firstName: customer.firstName,
          phone: customer.phone,
          optedOut: customer.optedOut,
        }
      : null,
    crewLead: lead ? { id: lead.id, name: lead.name, phone: lead.phone } : null,
    business: businessOf(tenant, owner?.name ?? null),
    style: readSettings(tenant).style,
    links: { projectForm: opts.projectForm ?? null },
  };
}
