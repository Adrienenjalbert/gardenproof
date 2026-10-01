import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { PHONES, T, seedJob, seedTenant } from "@/lib/bot/test-fixtures";
import { CustomerError, attachCustomerToJob, normaliseCustomerPhone } from "./customers";

beforeAll(() => seedTenant(), 120_000);

async function customersWith(phone: string) {
  return (await getDb()).select().from(schema.customers).where(and(eq(schema.customers.tenantId, T), eq(schema.customers.phone, phone)));
}
async function outboundTo(phone: string) {
  return (await getDb()).select().from(schema.messages).where(eq(schema.messages.toNumber, phone));
}
async function job(id: string) {
  return (await (await getDb()).select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0];
}

describe("normaliseCustomerPhone", () => {
  it("normalises UK mobiles to E.164, keeps foreign E.164, rejects landlines", () => {
    expect(normaliseCustomerPhone("07700 900150")).toBe("+447700900150");
    expect(normaliseCustomerPhone("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(normaliseCustomerPhone("020 7946 0000")).toBeNull();
    expect(normaliseCustomerPhone("+44 20 7946 0000")).toBeNull();
  });
});

describe("attachCustomerToJob", () => {
  it("creates the customer, links the job and requests the review for a captured job", async () => {
    const j = await seedJob({ customerId: null, postcode: "SW19 5AB", area: "Wimbledon" });
    const res = await attachCustomerToJob(j.id, { firstName: "Emily", lastName: "Hart", phone: "07700 900150" }, "crw_marco");
    expect(res).toMatchObject({ created: true, testimonialRequested: true, customer: { firstName: "Emily", phone: "+447700900150", postcode: "SW19 5AB", area: "Wimbledon" } });
    expect(await job(j.id)).toMatchObject({ customerId: res.customer.id, status: "awaiting_testimonial" });
    const out = await outboundTo("+447700900150");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "held", meta: { kind: "review_request", jobId: j.id } });
    const [ev] = await (await getDb()).select().from(schema.events).where(and(eq(schema.events.type, "customer.attached"), eq(schema.events.entityId, j.id)));
    expect(ev).toMatchObject({ actor: "crw_marco", data: { customerId: res.customer.id, created: true } });
  });

  it("is idempotent: the same contact twice reuses the customer and sends nothing twice", async () => {
    const j = await seedJob({ customerId: null });
    await attachCustomerToJob(j.id, { firstName: "Tom", phone: "+44 7700 900151" }, "agency");
    const again = await attachCustomerToJob(j.id, { firstName: "Thomas", phone: "07700900151" }, "agency");
    expect(again.created).toBe(false);
    expect(again.customer.firstName).toBe("Tom"); // never overwrites what is there
    expect(await customersWith("+447700900151")).toHaveLength(1);
    expect(await outboundTo("+447700900151")).toHaveLength(1);
  });

  it("finds an existing customer by phone and fills gaps only", async () => {
    const j = await seedJob({ customerId: null });
    const res = await attachCustomerToJob(j.id, { firstName: "Harriet", lastName: "Cole", phone: "07700 900101" }, "agency");
    expect(res.created).toBe(false);
    expect(res.customer.id).toBe("cus_harriet");
    expect(res.customer.lastName).toBe("Cole");
    expect(await customersWith(PHONES.harriet)).toHaveLength(1);
  });

  it("never creates duplicates under concurrent attaches", async () => {
    const [a, b] = [await seedJob({ customerId: null }), await seedJob({ customerId: null })];
    await Promise.all([
      attachCustomerToJob(a.id, { firstName: "Ivy", phone: "07700900152" }, "agency"),
      attachCustomerToJob(b.id, { firstName: "Ivy", phone: "+447700900152" }, "agency"),
    ]);
    expect(await customersWith("+447700900152")).toHaveLength(1);
  });

  it("links but doesn't ask while the job is still being captured, or once it is published", async () => {
    const capturing = await seedJob({ customerId: null, status: "capturing" });
    expect((await attachCustomerToJob(capturing.id, { firstName: "Al", phone: "07700900153" }, "agency")).testimonialRequested).toBe(false);
    expect((await job(capturing.id)).customerId).not.toBeNull();
    const published = await seedJob({ customerId: null, status: "published" });
    expect((await attachCustomerToJob(published.id, { firstName: "Bo", phone: "07700900154" }, "agency")).testimonialRequested).toBe(false);
    expect(await outboundTo("+447700900153")).toHaveLength(0);
    expect(await outboundTo("+447700900154")).toHaveLength(0);
  });

  it("asks for a review on a crew-only job that already went to content (dashboard fix for QA B12)", async () => {
    const j = await seedJob({ customerId: null, status: "in_review" });
    const res = await attachCustomerToJob(j.id, { firstName: "Cy", phone: "07700900155" }, "agency");
    expect(res.testimonialRequested).toBe(true);
  });

  it("rejects bad numbers, crew numbers and unknown jobs", async () => {
    const j = await seedJob({ customerId: null });
    await expect(attachCustomerToJob(j.id, { firstName: "X", phone: "020 7946 0000" }, "agency")).rejects.toBeInstanceOf(CustomerError);
    await expect(attachCustomerToJob(j.id, { firstName: "X", phone: "07700 900002" }, "agency")).rejects.toThrow(/team member/);
    await expect(attachCustomerToJob("job_missing", { firstName: "X", phone: "07700900156" }, "agency")).rejects.toThrow(/not found/);
    expect((await job(j.id)).customerId).toBeNull();
  });
});
