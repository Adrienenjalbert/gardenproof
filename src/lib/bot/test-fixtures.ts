/** Shared fixtures for module A tests (in-memory PGlite). Not imported by app code. */
import { getDb, schema } from "@/db";
import { THORBURN_CONFIG, type TenantConfig } from "@/lib/tenant";

export const T = "ten_test";
export const PHONES = {
  business: "+447700900000",
  stephen: "+447700900001",
  marco: "+447700900002",
  jake: "+447700900003",
  harriet: "+447700900101",
  otto: "+447700900109",
  stranger: "+447700900999",
};

export async function seedTenant(configOverride: Partial<TenantConfig> = {}): Promise<void> {
  const db = await getDb();
  await db.insert(schema.tenants).values({
    id: T,
    slug: "thorburn",
    name: "Thorburn Landscapes",
    whatsappNumber: PHONES.business,
    config: { ...THORBURN_CONFIG, ...configOverride },
  });
  await db.insert(schema.crewMembers).values([
    { id: "crw_stephen", tenantId: T, name: "Stephen", phone: PHONES.stephen, role: "owner" },
    { id: "crw_marco", tenantId: T, name: "Marco", phone: PHONES.marco, role: "foreman" },
    { id: "crw_jake", tenantId: T, name: "Jake", phone: PHONES.jake, role: "crew", team: "maintenance" },
  ]);
  await db.insert(schema.customers).values([
    { id: "cus_harriet", tenantId: T, firstName: "Harriet", phone: PHONES.harriet, postcode: "SW19 5AB", area: "Wimbledon" },
    { id: "cus_otto", tenantId: T, firstName: "Otto", phone: PHONES.otto, optedOut: true },
    { id: "cus_nophone", tenantId: T, firstName: "Nia", phone: null },
  ]);
}

// Sequential codes: random ones collided on the (tenant, code) unique index now and then (flaky tests).
let jobSeq = 0;

export async function seedJob(over: Partial<typeof schema.jobs.$inferInsert> = {}) {
  const db = await getDb();
  const [job] = await db
    .insert(schema.jobs)
    .values({
      id: `job_${Math.random().toString(36).slice(2, 10)}`,
      tenantId: T,
      code: `TX-${String(++jobSeq).padStart(4, "0")}`,
      customerId: "cus_harriet",
      status: "captured",
      service: "full_design",
      postcode: "SW19 5AB",
      area: "Wimbledon",
      ...over,
    })
    .returning();
  return job;
}
