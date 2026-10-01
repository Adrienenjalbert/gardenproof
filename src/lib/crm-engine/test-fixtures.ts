/** Fixtures for CRM engine / owner app tests (in-memory PGlite). Not imported by app code. */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { THORBURN_CONFIG } from "@/lib/tenant";

export const TEN = "ten_crm";
export const PH = {
  business: "+447700900500",
  stephen: "+447700900501",
  marco: "+447700900502",
  jake: "+447700900503",
  amelia: "+447700900601",
  tom: "+447700900602",
  stopper: "+447700900699",
};

export async function seedCrmTenant(settings: Record<string, unknown> = {}): Promise<void> {
  const db = await getDb();
  const [exists] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, TEN));
  if (exists) return;
  await db.insert(schema.tenants).values({
    id: TEN,
    slug: "crm-test",
    name: "Thorburn Landscapes",
    whatsappNumber: PH.business,
    config: { ...THORBURN_CONFIG, phone: "020 8064 1303" },
    settings,
  });
  await db.insert(schema.crewMembers).values([
    {
      id: "crm_stephen",
      tenantId: TEN,
      name: "Stephen",
      phone: PH.stephen,
      role: "owner",
      teamRole: "owner",
    },
    {
      id: "crm_marco",
      tenantId: TEN,
      name: "Marco",
      phone: PH.marco,
      role: "foreman",
      teamRole: "crew_lead",
      team: "landscaping",
    },
    {
      id: "crm_jake",
      tenantId: TEN,
      name: "Jake",
      phone: PH.jake,
      role: "crew",
      teamRole: "crew_lead",
      team: "maintenance",
    },
  ]);
  await db.insert(schema.customers).values([
    {
      id: "crm_amelia",
      tenantId: TEN,
      firstName: "Amelia",
      phone: PH.amelia,
      postcode: "SW13 9AA",
      area: "Barnes",
    },
    {
      id: "crm_tom",
      tenantId: TEN,
      firstName: "Tom",
      phone: PH.tom,
      postcode: "SW18 1AA",
      area: "Wandsworth",
    },
    {
      id: "crm_stopper",
      tenantId: TEN,
      firstName: "Otto",
      phone: PH.stopper,
      optedOut: true,
    },
  ]);
}

let seq = 0;
export async function seedCrmJob(over: Partial<typeof schema.jobs.$inferInsert> = {}) {
  const db = await getDb();
  const [job] = await db
    .insert(schema.jobs)
    .values({
      id: `crmjob_${++seq}_${Math.random().toString(36).slice(2, 7)}`,
      tenantId: TEN,
      code: `CR-${String(seq).padStart(4, "0")}`,
      customerId: "crm_amelia",
      status: "capturing",
      stage: "enquiry",
      team: "landscaping",
      service: "full_design",
      postcode: "SW13 9AA",
      area: "Barnes",
      ...over,
    })
    .returning();
  return job;
}

export async function setTenantSettings(settings: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.update(schema.tenants).set({ settings }).where(eq(schema.tenants.id, TEN));
}
