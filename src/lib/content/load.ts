/** DB loading for the content engine: one job with everything the writers need. */
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Customer, Job, Media, Tenant, Testimonial } from "@/db/schema";

export type JobBundle = {
  job: Job;
  tenant: Tenant;
  customer: Customer | null;
  testimonial: Testimonial | null;
  media: Media[];
  /** jobs.brief + voice-note transcripts: the factual source for copy. */
  crewNotes: string;
};

export async function loadJobBundle(jobId: string): Promise<JobBundle> {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) throw new Error(`Job ${jobId} not found`);
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, job.tenantId));
  if (!tenant) throw new Error(`Tenant ${job.tenantId} not found`);
  const [customer] = job.customerId
    ? await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId))
    : [];
  const [testimonial] = await db
    .select()
    .from(schema.testimonials)
    .where(eq(schema.testimonials.jobId, jobId))
    .orderBy(desc(schema.testimonials.createdAt))
    .limit(1);
  const media = await db.select().from(schema.media).where(eq(schema.media.jobId, jobId)).orderBy(schema.media.createdAt);
  const transcripts = media.filter((m) => m.kind === "audio" && m.transcript?.trim()).map((m) => m.transcript!.trim());
  return {
    job,
    tenant,
    customer: customer ?? null,
    testimonial: testimonial ?? null,
    media,
    crewNotes: [job.brief?.trim(), ...transcripts].filter(Boolean).join("\n\n"),
  };
}
