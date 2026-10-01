/**
 * Homeowners (customers). A job only enters the testimonial + consent loop once it is linked to a customer
 * with a phone; the crew does that from WhatsApp right after Done (contact card or typed mobile), the agency
 * from the dashboard. Phones are stored as E.164 and are unique per tenant (enforced here under an advisory lock,
 * so a double tap can't create two customers).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Customer, Job } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { newId } from "@/lib/ids";
import { parseUkMobile } from "@/lib/messaging/format";
import { areaFromPostcode } from "@/lib/tenant";
import { getTenant } from "@/lib/tenants";
import { requestTestimonial } from "@/lib/testimonials";

export class CustomerError extends Error {}

const name = z
  .string()
  .trim()
  .max(60)
  .transform((v) => v || null)
  .nullish();

export const CustomerContactSchema = z.object({
  /** Null when only a number was typed; the review request then opens with "Hi there". */
  firstName: name,
  lastName: name,
  phone: z.string().min(5).max(40),
  postcode: z.string().trim().max(10).nullish(),
});
export type CustomerContact = z.input<typeof CustomerContactSchema>;

/**
 * UK mobiles in any common format, or an international number already in E.164.
 * Landlines are rejected: WhatsApp needs a mobile.
 */
export function normaliseCustomerPhone(raw: string): string | null {
  const uk = parseUkMobile(raw);
  if (uk) return uk;
  const compact = raw.trim().replace(/[\s().-]/g, "");
  return /^\+(?!44)[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

/** Job statuses where asking the homeowner still makes sense (not while capturing; never once published). */
const REQUESTABLE: Job["status"][] = ["captured", "awaiting_testimonial", "ready_for_content", "content_draft", "in_review"];

export type AttachResult = {
  customer: Customer;
  created: boolean;
  /** A review request exists (or was just created / held) for this job. */
  testimonialRequested: boolean;
};

/**
 * Find-or-create the customer by phone and link them to the job, then ask for the testimonial if the job
 * is finished. Idempotent: attaching the same contact twice changes nothing and sends nothing twice.
 */
export async function attachCustomerToJob(jobId: string, contact: CustomerContact, actor: string): Promise<AttachResult> {
  const input = CustomerContactSchema.parse(contact);
  const phone = normaliseCustomerPhone(input.phone);
  if (!phone) throw new CustomerError("That doesn't look like a mobile number.");

  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) throw new CustomerError("Job not found.");
  const tenant = await getTenant(job.tenantId);

  const [crew] = await db
    .select({ id: schema.crewMembers.id })
    .from(schema.crewMembers)
    .where(and(eq(schema.crewMembers.tenantId, job.tenantId), eq(schema.crewMembers.phone, phone)));
  if (crew) throw new CustomerError("That's a team member's number, not the homeowner's.");

  const postcode = input.postcode?.toUpperCase() || job.postcode;
  const area = postcode ? (areaFromPostcode(postcode, tenant.config) ?? job.area) : job.area;

  const { customer, created } = await db.transaction(async (tx) => {
    // Serialise find-or-create per (tenant, phone): the schema has no unique constraint on phone.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`customer:${job.tenantId}:${phone}`}))`);
    const [existing] = await tx
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, job.tenantId), eq(schema.customers.phone, phone)))
      .orderBy(desc(schema.customers.createdAt))
      .limit(1);
    if (existing) {
      // Fill gaps only: never overwrite what the office has already corrected.
      const patch: Partial<Customer> = {};
      if (!existing.firstName && input.firstName) patch.firstName = input.firstName;
      if (!existing.lastName && input.lastName) patch.lastName = input.lastName;
      if (!existing.postcode && postcode) patch.postcode = postcode;
      if (!existing.area && area) patch.area = area;
      const [row] = Object.keys(patch).length
        ? await tx.update(schema.customers).set(patch).where(eq(schema.customers.id, existing.id)).returning()
        : [existing];
      return { customer: row, created: false };
    }
    const [row] = await tx
      .insert(schema.customers)
      .values({
        id: newId("cus"),
        tenantId: job.tenantId,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        phone,
        postcode: postcode ?? null,
        area: area ?? null,
      })
      .returning();
    return { customer: row, created: true };
  });

  if (job.customerId !== customer.id) {
    await db.update(schema.jobs).set({ customerId: customer.id, updatedAt: new Date() }).where(eq(schema.jobs.id, jobId));
    await logEvent({
      tenantId: job.tenantId,
      type: "customer.attached",
      entity: "job",
      entityId: jobId,
      actor,
      data: { customerId: customer.id, created, replaced: job.customerId },
    });
  }

  const testimonialRequested = REQUESTABLE.includes(job.status) ? await requestTestimonial(jobId) : false;
  return { customer, created, testimonialRequested };
}
