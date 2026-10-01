import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { PHONES, T, seedJob, seedTenant } from "@/lib/bot/test-fixtures";
import { formPhotoExists, readFormPhoto, storeFormPhoto } from "./photos";
import { completeForm, createFormLink, FormError, getForm, initialValues, saveAnswer } from "./store";

beforeAll(() => seedTenant(), 120_000);

/** postcodes.io stand-ins (tests never touch the network). */
const found = (district = "Merton") => (async () => Response.json({ status: 200, result: { postcode: "SW19 5AB", outcode: "SW19", admin_district: district } })) as unknown as typeof fetch;
const notFound = (async () => Response.json({ status: 404, error: "Invalid postcode" }, { status: 404 })) as unknown as typeof fetch;
const offline = (async () => {
  throw new Error("ENOTFOUND");
}) as unknown as typeof fetch;

async function db() {
  return getDb();
}

async function fillEnquiry(token: string, phone = "07700 900150") {
  await saveAnswer(token, "services", ["patio_paving", "planting"]);
  await saveAnswer(token, "size", "medium");
  await saveAnswer(token, "budget", "20_40k");
  await saveAnswer(token, "timing", { choice: "asap" });
  await saveAnswer(token, "photos", null);
  await saveAnswer(token, "postcode", { postcode: "sw19 5ab" }, { fetchImpl: found() });
  await saveAnswer(token, "contact", { firstName: "Emily", lastName: "Hart", phone, consent: true });
  return saveAnswer(token, "callTime", { days: ["weekdays"], windows: ["morning"] });
}

describe("createFormLink", () => {
  it("creates a resumable link, prefilled from the customer on file", async () => {
    const link = await createFormLink({ tenantId: T, kind: "maintenance_visit", customerId: "cus_harriet", source: "whatsapp" });
    expect(link.url).toMatch(new RegExp(`/f/${link.token}$`));
    const form = await getForm(link.token);
    expect(form).toMatchObject({ kind: "maintenance_visit", completed: false, index: 0, meta: { prefill: { firstName: "Harriet", phone: PHONES.harriet, postcode: "SW19 5AB" } } });
  });

  it("refuses reviews (they keep /r/<token>) and other tenants' customers", async () => {
    await expect(createFormLink({ tenantId: T, kind: "review" })).rejects.toBeInstanceOf(FormError);
    await expect(createFormLink({ tenantId: T, kind: "enquiry", customerId: "cus_nobody" })).rejects.toThrow(/Unknown customer/);
  });

  it("turns prefill into starting values (never into saved answers)", async () => {
    const link = await createFormLink({ tenantId: T, kind: "enquiry", prefill: { firstName: "Tom", phone: "+447700900160", postcode: "sw15 2qt", service: "patio_paving,bogus" } });
    const form = (await getForm(link.token))!;
    expect(form.answers).toEqual({});
    expect(initialValues(form)).toMatchObject({
      services: ["patio_paving"],
      postcode: { postcode: "SW15 2QT" },
      contact: { firstName: "Tom", phone: "+447700900160", consent: false },
    });
  });
});

describe("saveAnswer", () => {
  it("saves each answer as it is given and reports progress", async () => {
    const { token } = await createFormLink({ tenantId: T, kind: "enquiry" });
    const r = await saveAnswer(token, "services", ["full_design"]);
    expect(r).toMatchObject({ value: ["full_design"], index: 1, answers: { services: ["full_design"] } });
    const row = (await getForm(token))!.row;
    expect(row.step).toBe(1);
    expect(row.answers).toHaveProperty("_meta"); // server metadata survives the merge
  });

  it("rejects unknown steps, reserved keys, invalid values and finished forms", async () => {
    const { token } = await createFormLink({ tenantId: T, kind: "enquiry" });
    await expect(saveAnswer(token, "nope", "x")).rejects.toMatchObject({ code: "unknown_step" });
    await expect(saveAnswer(token, "_meta", {})).rejects.toMatchObject({ code: "unknown_step" });
    await expect(saveAnswer(token, "size", "enormous")).rejects.toMatchObject({ code: "invalid", details: { stepId: "size" } });
    await expect(saveAnswer("not-a-real-token-at-all", "size", "small")).rejects.toMatchObject({ code: "not_found" });
  });

  it("fills the area from the postcode, degrades gracefully offline, and refuses postcodes that don't exist", async () => {
    const { token } = await createFormLink({ tenantId: T, kind: "enquiry" });
    expect((await saveAnswer(token, "postcode", { postcode: "sw195ab" }, { fetchImpl: found() })).value).toEqual({
      postcode: "SW19 5AB",
      area: "Wimbledon",
      district: "Merton",
      verified: true,
      inArea: true,
    });
    expect((await saveAnswer(token, "postcode", "SE1 9SG", { fetchImpl: offline })).value).toEqual({ postcode: "SE1 9SG", area: null, district: null, verified: false, inArea: false });
    await expect(saveAnswer(token, "postcode", "ZZ9 9ZZ", { fetchImpl: notFound })).rejects.toMatchObject({ code: "invalid" });
  });

  it("keeps both answers when two saves race", async () => {
    const { token } = await createFormLink({ tenantId: T, kind: "enquiry" });
    await Promise.all([saveAnswer(token, "services", ["planting"]), saveAnswer(token, "size", "large"), saveAnswer(token, "budget", "40_75k")]);
    expect((await getForm(token))!.answers).toMatchObject({ services: ["planting"], size: "large", budget: "40_75k" });
  });

  it("only accepts photos uploaded to this very form", async () => {
    const a = await createFormLink({ tenantId: T, kind: "enquiry" });
    const b = await createFormLink({ tenantId: T, kind: "enquiry" });
    const jpeg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#4a7" } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "secret", Artist: "Harriet" } } })
      .toBuffer();
    const photo = await storeFormPhoto((await getForm(a.token))!.row.id, jpeg);
    expect(photo).toMatchObject({ width: 2000, height: 1333 });
    const stored = await sharp(await readFormPhoto((await getForm(a.token))!.row.id, photo.id)).metadata();
    expect(stored.exif).toBeUndefined();
    expect(await formPhotoExists((await getForm(b.token))!.row.id, photo.id)).toBe(false);
    await expect(saveAnswer(b.token, "photos", [photo])).rejects.toMatchObject({ code: "invalid" });
    expect((await saveAnswer(a.token, "photos", [photo])).value).toEqual([photo]);
  });
});

describe("completeForm", () => {
  it("refuses to complete while required questions are unanswered", async () => {
    const { token } = await createFormLink({ tenantId: T, kind: "enquiry" });
    await saveAnswer(token, "services", ["planting"]);
    await expect(completeForm(token)).rejects.toMatchObject({ code: "incomplete", details: { stepId: "postcode" } });
  });

  it("turns an enquiry into a customer, a job at 'enquiry' and an attributed lead, once", async () => {
    const { token } = await createFormLink({
      tenantId: T,
      kind: "enquiry",
      source: "google",
      attribution: { first: { source: "google", medium: "cpc", campaign: "spring", gclid: "g-1", content: "asset_nope" }, last: { source: "google", gclid: "g-2" } },
      projectSlug: "pond-garden-wimbledon",
    });
    await fillEnquiry(token);
    const first = await completeForm(token);
    const again = await completeForm(token);
    expect(first.alreadyCompleted).toBe(false);
    expect(again).toEqual({ alreadyCompleted: true, result: first.result });

    const d = await db();
    const [customer] = await d.select().from(schema.customers).where(eq(schema.customers.id, first.result.customerId!));
    expect(customer).toMatchObject({ firstName: "Emily", lastName: "Hart", phone: "+447700900150", postcode: "SW19 5AB", area: "Wimbledon" });
    const [job] = await d.select().from(schema.jobs).where(eq(schema.jobs.id, first.result.jobId!));
    expect(job).toMatchObject({ stage: "enquiry", status: "captured", customerId: customer.id, service: "patio_paving", valueBand: "£20k – £40k", area: "Wimbledon", title: "Patios & paving, Planting schemes, Wimbledon" });
    expect(job.code).toMatch(/^TL-\d{4}$/);
    expect(job.brief).toContain("Budget: £20k – £40k");
    const [lead] = await d.select().from(schema.leads).where(eq(schema.leads.id, first.result.leadId!));
    expect(lead).toMatchObject({ source: "google", medium: "cpc", campaign: "spring", gclid: "g-2", assetId: null, projectSlug: "pond-garden-wimbledon", phone: "+447700900150", postcode: "SW19 5AB", service: "patio_paving" });
    expect(lead.attribution).toMatchObject({ formId: (await getForm(token))!.row.id });

    const stage = await d.select().from(schema.jobStageEvents).where(eq(schema.jobStageEvents.jobId, job.id));
    expect(stage.map((s) => s.toStage)).toEqual(["enquiry"]);
    const toOwner = await d.select().from(schema.messages).where(and(eq(schema.messages.toNumber, PHONES.stephen), eq(schema.messages.direction, "out")));
    expect(toOwner.some((m) => m.body?.includes("Emily"))).toBe(true);
    const form = (await getForm(token))!;
    expect(form).toMatchObject({ completed: true, row: { customerId: customer.id, jobId: job.id } });
    await expect(saveAnswer(token, "size", "small")).rejects.toMatchObject({ code: "completed" });
  });

  it("reuses an existing customer by phone and never overwrites what's on file", async () => {
    const { token } = await createFormLink({ tenantId: T, kind: "enquiry" });
    await fillEnquiry(token, "07700 900101"); // Harriet's number
    const { result } = await completeForm(token);
    expect(result.customerId).toBe("cus_harriet");
    const [c] = await (await db()).select().from(schema.customers).where(eq(schema.customers.id, "cus_harriet"));
    expect(c.firstName).toBe("Harriet");
  });

  it("drops answers to questions that no longer apply", async () => {
    const { token } = await createFormLink({ tenantId: T, kind: "enquiry" });
    await fillEnquiry(token);
    await saveAnswer(token, "services", ["maintenance"]);
    await saveAnswer(token, "frequency", "monthly");
    const { result } = await completeForm(token);
    const [job] = await (await db()).select().from(schema.jobs).where(eq(schema.jobs.id, result.jobId!));
    expect(job).toMatchObject({ team: "maintenance", valueBand: null, service: "maintenance" });
    expect((await getForm(token))!.answers).not.toHaveProperty("budget");
  });

  it("tells the owner straight away when a maintenance visit wasn't right, and not when it was", async () => {
    const d = await db();
    const job = await seedJob({ stage: "maintenance", team: "maintenance" });
    const count = async () => (await d.select().from(schema.messages).where(eq(schema.messages.toNumber, PHONES.stephen))).length;
    const before = await count();
    const good = await createFormLink({ tenantId: T, kind: "maintenance_visit", customerId: "cus_harriet", jobId: job.id });
    await saveAnswer(good.token, "feeling", "great");
    await saveAnswer(good.token, "note", null);
    expect((await completeForm(good.token)).result).toEqual({ urgent: false });
    expect(await count()).toBe(before);

    const bad = await createFormLink({ tenantId: T, kind: "maintenance_visit", customerId: "cus_harriet", jobId: job.id });
    await saveAnswer(bad.token, "feeling", "issue");
    await saveAnswer(bad.token, "issues", ["hedges", "tidy"]);
    await saveAnswer(bad.token, "note", "Clippings left on the lawn");
    expect((await completeForm(bad.token)).result).toEqual({ urgent: true });
    const msgs = await d.select().from(schema.messages).where(eq(schema.messages.toNumber, PHONES.stephen));
    expect(msgs.length).toBe(before + 1);
    expect(msgs.at(-1)?.body).toMatch(/Harriet isn't happy with today's visit[\s\S]*Hedges, Left untidy[\s\S]*Clippings left on the lawn/);
  });
});
