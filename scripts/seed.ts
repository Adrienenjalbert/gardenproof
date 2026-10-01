/**
 * Seed demo data: Thorburn tenant, crew, customers and 3 jobs using real Thorburn footage stills, plus the v2 CRM
 * demo (scripts/seed-crm.ts): jobs in every stage, team roles, stage history, planned messages, and the confirmed
 * business profile from data/profiles/thorburn-landscapes.json when that file exists.
 * Idempotent: wipes and re-creates the demo tenant.  Run: pnpm seed  (SEED_CONTENT=off skips drafting pages)
 * Refuses in production unless ALLOW_DEMO_SEED=yes: it deletes the tenant's jobs, consent evidence and tasks.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { newToken } from "@/lib/ids";
import { putObject } from "@/lib/storage";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { seedCrmDemo } from "./seed-crm";

const TENANT_ID = "ten_thorburn";

async function copyDemo(file: string, key: string) {
  const buf = await fs.readFile(path.join(process.cwd(), "public", "demo", file));
  return putObject(key, buf);
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "yes") {
    throw new Error("Refusing to seed: this wipes the tenant. Set ALLOW_DEMO_SEED=yes if you really mean it.");
  }
  const db = await getDb();

  // wipe demo tenant (children first)
  for (const table of [
    schema.scheduledMessages,
    schema.jobStageEvents,
    schema.formResponses,
    schema.onboardingRuns,
    schema.tasks,
    schema.events,
    schema.leads,
    schema.assets,
    schema.messages,
    schema.conversations,
    schema.testimonials,
    schema.media,
    schema.jobs,
    schema.customers,
    schema.crewMembers,
  ]) {
    await db.delete(table).where(eq(table.tenantId, TENANT_ID));
  }
  await db.delete(schema.tenants).where(eq(schema.tenants.id, TENANT_ID));

  await db.insert(schema.tenants).values({
    id: TENANT_ID,
    slug: "thorburn",
    name: "Thorburn Landscapes",
    whatsappNumber: "+447700900000",
    config: THORBURN_CONFIG,
  });

  // Ofcom drama-range numbers (07700 900xxx) — never real people.
  const crew = [
    { id: "crw_stephen", name: "Stephen", phone: "+447700900001", role: "owner" as const, team: "landscaping" as const, teamRole: "owner" as const },
    { id: "crw_marco", name: "Marco", phone: "+447700900002", role: "foreman" as const, team: "landscaping" as const, teamRole: "crew_lead" as const },
    { id: "crw_jake", name: "Jake", phone: "+447700900003", role: "crew" as const, team: "maintenance" as const, teamRole: "crew" as const },
    { id: "crw_natalia", name: "Natalia", phone: "+447700900004", role: "admin" as const, team: "landscaping" as const, teamRole: "office" as const },
  ];
  await db.insert(schema.crewMembers).values(crew.map((c) => ({ ...c, tenantId: TENANT_ID })));

  const customers = [
    { id: "cus_harriet", firstName: "Harriet", lastName: "Cole", phone: "+447700900101", postcode: "SW19 5AB", area: "Wimbledon" },
    { id: "cus_james", firstName: "James", lastName: "Patel", phone: "+447700900102", postcode: "SW15 2QT", area: "Putney" },
    { id: "cus_olivia", firstName: "Olivia", lastName: "Grant", phone: "+447700900103", postcode: "SW4 9LE", area: "Clapham" },
  ];
  await db.insert(schema.customers).values(customers.map((c) => ({ ...c, tenantId: TENANT_ID })));

  const day = 24 * 3600 * 1000;
  const now = Date.now();

  // Job 1 — pond & gravel garden, Wimbledon. Captured, awaiting testimonial → good for demoing the homeowner flow.
  await db.insert(schema.jobs).values({
    id: "job_pond",
    tenantId: TENANT_ID,
    code: "TL-4821",
    customerId: "cus_harriet",
    status: "captured",
    team: "landscaping",
    service: "full_design",
    postcode: "SW19 5AB",
    area: "Wimbledon",
    title: "Pond & gravel garden, Wimbledon",
    brief:
      "Overgrown back garden, knee-high grass, old pergola and junk everywhere. Cleared it all, laid a self-binding gravel terrace with a circular brick-edged pond and solar fountain, new lawn at the back, cleaned up the borders and kept the mature trees. About three weeks.",
    createdByCrewId: "crw_marco",
    startedAt: new Date(now - 24 * day),
    completedAt: new Date(now - 2 * day),
  });
  const pondBefore = await copyDemo("pond-garden-before.jpg", "thorburn/job_pond/before-1.jpg");
  const pondAfter = await copyDemo("pond-garden-after.jpg", "thorburn/job_pond/after-1.jpg");
  await db.insert(schema.media).values([
    { id: "med_pond_b1", tenantId: TENANT_ID, jobId: "job_pond", stage: "before", kind: "image", storageKey: pondBefore, publicKey: pondBefore, mimeType: "image/jpeg", width: 720, height: 720 },
    { id: "med_pond_a1", tenantId: TENANT_ID, jobId: "job_pond", stage: "after", kind: "image", storageKey: pondAfter, publicKey: pondAfter, mimeType: "image/jpeg", width: 720, height: 720 },
  ]);

  // Job 2 — sandstone patio with curved brick raised beds, Putney. Testimonial already in → ready for content.
  await db.insert(schema.jobs).values({
    id: "job_patio",
    tenantId: TENANT_ID,
    code: "TL-5937",
    customerId: "cus_james",
    status: "ready_for_content",
    team: "landscaping",
    service: "patio_paving",
    postcode: "SW15 2QT",
    area: "Putney",
    title: "Sandstone patio & brick raised beds, Putney",
    brief:
      "Indian sandstone patio in a circle pattern with a red brick band, two curved brick raised beds planted up, new striped lawn and a timber pergola. Took two and a half weeks.",
    createdByCrewId: "crw_marco",
    startedAt: new Date(now - 30 * day),
    completedAt: new Date(now - 6 * day),
  });
  const patioAfter = await copyDemo("sandstone-patio-after.jpg", "thorburn/job_patio/after-1.jpg");
  await db.insert(schema.media).values([
    { id: "med_patio_a1", tenantId: TENANT_ID, jobId: "job_patio", stage: "after", kind: "image", storageKey: patioAfter, publicKey: patioAfter, mimeType: "image/jpeg", width: 1280, height: 720 },
  ]);
  await db.insert(schema.testimonials).values({
    id: "tst_patio",
    tenantId: TENANT_ID,
    jobId: "job_patio",
    customerId: "cus_james",
    token: newToken(),
    status: "responded",
    rating: 5,
    quote: "Stephen's team were tidy, on time and the patio is exactly what we pictured. We use the garden every evening now.",
    consentPhotos: true,
    consentArea: true,
    consentFirstName: true,
    consentQuote: true,
    consentWording: "I'm happy for Thorburn Landscapes to show photos of my garden, my words, my area (not my address) and my first name on their website and social media.",
    consentedAt: new Date(now - 4 * day),
    maintenanceInterest: true,
    sentAt: new Date(now - 5 * day),
    respondedAt: new Date(now - 4 * day),
  });

  // Job 3 — garden room, lawn & stepping stones, Clapham. Still capturing (no after yet) → shows crew in progress.
  await db.insert(schema.jobs).values({
    id: "job_room",
    tenantId: TENANT_ID,
    code: "TL-6254",
    customerId: "cus_olivia",
    status: "capturing",
    team: "landscaping",
    service: "structures",
    postcode: "SW4 9LE",
    area: "Clapham",
    title: "Garden room, lawn & stepping stones, Clapham",
    brief: null,
    createdByCrewId: "crw_marco",
    startedAt: new Date(now - 3 * day),
  });
  const roomAfter = await copyDemo("garden-room-after.jpg", "thorburn/job_room/progress-1.jpg");
  await db.insert(schema.media).values([
    { id: "med_room_p1", tenantId: TENANT_ID, jobId: "job_room", stage: "progress", kind: "image", storageKey: roomAfter, publicKey: roomAfter, mimeType: "image/jpeg", width: 1280, height: 720 },
  ]);

  const crm = await seedCrmDemo(TENANT_ID);
  console.log(`Seeded Thorburn demo tenant: 4 team members, ${3 + crm.customers} customers, ${3 + crm.jobs} jobs.`);
  console.log(crm.summary);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
