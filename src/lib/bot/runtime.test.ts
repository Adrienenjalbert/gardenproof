import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { getObject } from "@/lib/storage";
import { HOMEOWNER_GRACE_MS } from "@/lib/tasks";
import { PHONES, T, seedJob, seedTenant } from "./test-fixtures";
import { handleInbound, isDuplicateProviderId, type InboundInput } from "./index";
import { makePublicDerivative } from "./media";

let before: Buffer;
let after: Buffer;
beforeAll(async () => {
  await seedTenant();
  before = await fs.readFile(path.join(process.cwd(), "public/demo/pond-garden-before.jpg"));
  after = await fs.readFile(path.join(process.cwd(), "public/demo/pond-garden-after.jpg"));
}, 120_000);

const jpg = (buffer: Buffer) => ({ buffer, mimeType: "image/jpeg" });
const say = (from: string, body: string, extra: Partial<InboundInput> = {}) =>
  handleInbound({ tenantId: T, from, body, channel: "simulator", ...extra });

async function outboundTo(phone: string) {
  const db = await getDb();
  return db.select().from(schema.messages).where(and(eq(schema.messages.toNumber, phone), eq(schema.messages.direction, "out"))).orderBy(asc(schema.messages.createdAt));
}
async function lastOut(phone: string) {
  const rows = await outboundTo(phone);
  return rows[rows.length - 1];
}
async function jobCompletedTask(jobId: string) {
  const db = await getDb();
  const [t] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.type, "pipeline.job_completed"), sql`${schema.tasks.payload}->>'jobId' = ${jobId}`));
  return t;
}
const vcard = (name: string, phone: string) =>
  Buffer.from(`BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${name}\r\nN:${name.split(" ")[1] ?? ""};${name.split(" ")[0]};;;\r\nitem1.TEL;waid=${phone.replace("+", "")}:${phone}\r\nEND:VCARD\r\n`);
async function conversation(phone: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.conversations).where(eq(schema.conversations.phone, phone));
  return c;
}

describe("handleInbound — full crew capture end to end", () => {
  it("captures a job in ≤ 8 taps + photos, stores media safely and queues the pipeline", async () => {
    let taps = 0;
    const tap = async (choiceId: string) => {
      taps++;
      return say(PHONES.marco, "", { choiceId });
    };

    // Photos first, no words: a job starts.
    await say("whatsapp:+447700900002", "", { media: [jpg(before), jpg(before)] });
    const conv = await conversation(PHONES.marco);
    expect(conv.role).toBe("crew");
    const jobId = conv.activeJobId!;
    expect(jobId).toMatch(/^job_/);
    let reply = await lastOut(PHONES.marco);
    expect(reply.body).toMatch(/Got 2 before photos\. New job TL-\d{4}\. What's the job\?/);
    expect(reply.options).toHaveLength(7);
    expect(reply.status).toBe("sent"); // crew messages are never held

    await tap("svc:full_design");
    // QA B6: a bare tap is stored with the option's title, so the chat shows what was chosen.
    const db0 = await getDb();
    const [tapped] = await db0.select().from(schema.messages).where(and(eq(schema.messages.fromNumber, PHONES.marco), eq(schema.messages.direction, "in"))).orderBy(asc(schema.messages.createdAt)).offset(1).limit(1);
    expect(tapped.body).toBe("Garden design & build");
    reply = await lastOut(PHONES.marco);
    expect(reply.options.map((o) => o.id)).toContain("pc:SW19");
    await say(PHONES.marco, "sw19 5ab"); // typed postcode also works (not a tap)
    await tap("before:next");
    await say(PHONES.marco, "", { media: [{ buffer: Buffer.from("OggS-fake-voice"), mimeType: "audio/ogg; codecs=opus" }] });
    await tap("work:finish");
    reply = await lastOut(PHONES.marco);
    expect(reply.mediaUrls).toHaveLength(1); // framing guide
    expect(reply.mediaUrls[0]).toMatch(/\/api\/media\/thorburn\/job_.+\/before-[A-Za-z0-9]{12}\.public\.jpg$/);
    await say(PHONES.marco, "", { media: [jpg(after)] });
    const doneAt = Date.now();
    await tap("after:done");

    // Done marks the job captured at once and queues the pipeline after a grace period for the homeowner step.
    reply = await lastOut(PHONES.marco);
    expect(reply.body).toContain("Wrapped: TL-");
    expect(reply.options).toEqual([{ id: "home:skip", title: "Skip" }]);
    const queued = await jobCompletedTask(jobId);
    expect(queued.status).toBe("queued");
    expect(queued.runAt.getTime()).toBeGreaterThanOrEqual(doneAt + HOMEOWNER_GRACE_MS - 5_000);

    await tap("home:skip");
    expect(taps).toBeLessThanOrEqual(8);
    expect((await jobCompletedTask(jobId)).runAt.getTime()).toBeLessThanOrEqual(Date.now()); // pulled forward

    const db = await getDb();
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job).toMatchObject({ status: "captured", service: "full_design", postcode: "SW19 5AB", area: "Wimbledon", title: "Garden design & build, Wimbledon", createdByCrewId: "crw_marco", team: "landscaping" });
    expect(job.completedAt).toBeInstanceOf(Date);

    const media = await db.select().from(schema.media).where(eq(schema.media.jobId, jobId)).orderBy(asc(schema.media.createdAt));
    expect(media.map((m) => `${m.stage}:${m.kind}`)).toEqual(["before:image", "before:image", "progress:audio", "after:image"]);
    // Originals live under private/ with unguessable names; only the EXIF-stripped copy is public.
    expect(media[0].storageKey).toMatch(new RegExp(`^private/thorburn/${jobId}/before-[A-Za-z0-9]{12}\\.jpg$`));
    expect(media[1].storageKey).not.toBe(media[0].storageKey);
    expect(media[0].publicKey).toBe(media[0].storageKey.replace(/^private\//, "").replace(/\.jpg$/, ".public.jpg"));
    expect(media[0]).toMatchObject({ width: 720, height: 720, mimeType: "image/jpeg" });
    expect(media[2]).toMatchObject({ publicKey: null, transcript: null, mimeType: "audio/ogg" });
    expect(media[2].storageKey).toMatch(new RegExp(`^private/thorburn/${jobId}/progress-[A-Za-z0-9]{12}\\.ogg$`));

    // Inbound messages link to what was stored: public copies only, never an original or a voice note.
    const inbound = await db.select().from(schema.messages).where(eq(schema.messages.id, media[0].sourceMessageId!));
    expect(inbound[0].mediaUrls).toHaveLength(2);
    expect(inbound[0].mediaUrls.every((u) => u.endsWith(".public.jpg") && !u.includes("private/"))).toBe(true);
    const voice = await db.select().from(schema.messages).where(eq(schema.messages.id, media[2].sourceMessageId!));
    expect(voice[0]).toMatchObject({ mediaUrls: [], body: "Voice note" });
    expect((await conversation(PHONES.marco)).activeJobId).toBeNull();
  });

  it("serialises a burst of photos so only one job is created", async () => {
    const db = await getDb();
    const beforeCount = (await db.select().from(schema.jobs)).length;
    await Promise.all([
      say(PHONES.jake, "", { media: [jpg(before)] }),
      say(PHONES.jake, "", { media: [jpg(before)] }),
      say(PHONES.jake, "", { media: [jpg(before)] }),
    ]);
    expect((await db.select().from(schema.jobs)).length).toBe(beforeCount + 1);
    const jobId = (await conversation(PHONES.jake)).activeJobId!;
    const media = await db.select().from(schema.media).where(eq(schema.media.jobId, jobId));
    expect(media).toHaveLength(3);
    // Only the first photo of the burst got a reply.
    const replies = (await outboundTo(PHONES.jake)).filter((m) => m.createdAt.getTime() > Date.now() - 60_000);
    expect(replies).toHaveLength(1);
    // Maintenance crew sees maintenance first.
    expect(replies[0].options[0]).toEqual({ id: "svc:maintenance", title: "Garden maintenance" });
    await say(PHONES.jake, "cancel");
  });

  it("ignores Twilio retries with the same MessageSid", async () => {
    const first = await say(PHONES.stephen, "status", { providerId: "SM_dup_1" });
    const again = await say(PHONES.stephen, "status", { providerId: "SM_dup_1" });
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    const db = await getDb();
    expect(await db.select().from(schema.messages).where(eq(schema.messages.providerId, "SM_dup_1"))).toHaveLength(1);
  });

  it("picks an existing job by its code", async () => {
    const job = await seedJob({ status: "capturing", code: "TL-7373", customerId: null });
    await say(PHONES.stephen, "tl7373");
    expect((await conversation(PHONES.stephen)).activeJobId).toBe(job.id);
    expect((await lastOut(PHONES.stephen)).body).toContain("Picked up TL-7373");
  });

  it("replies once, politely, to unknown numbers", async () => {
    await say(PHONES.stranger, "hello, do you do hedges?");
    await say(PHONES.stranger, "hello??");
    const out = await outboundTo(PHONES.stranger);
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain("job-photo line");
    expect(out[0].status).toBe("sent");
    expect((await conversation(PHONES.stranger)).role).toBe("unknown");
  });

  it("customer STOP opts out; other customer messages reach the owner", async () => {
    const db = await getDb();
    await say(PHONES.harriet, "Thank you, it looks wonderful");
    expect((await lastOut(PHONES.stephen)).body).toBe('Harriet sent a WhatsApp message: "Thank you, it looks wonderful"');
    await say(PHONES.harriet, "STOP");
    const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, "cus_harriet"));
    expect(c.optedOut).toBe(true);
    expect(await outboundTo(PHONES.harriet)).toHaveLength(0); // never messaged back
    await say(PHONES.harriet, "START");
    const [c2] = await db.select().from(schema.customers).where(eq(schema.customers.id, "cus_harriet"));
    expect(c2.optedOut).toBe(false);
  });

  it("tells the crew when a photo didn't come through", async () => {
    await say(PHONES.marco, "", { media: [{ url: "http://127.0.0.1:1/nope.jpg", mimeType: "image/jpeg" }] });
    expect((await lastOut(PHONES.marco)).body).toContain("didn't come through");
  });

  it("after Done, a shared contact card creates the customer, links the job and requests the review", async () => {
    const db = await getDb();
    await say(PHONES.stephen, "new job");
    for (const choiceId of ["svc:fencing", "pc:SW15"]) await say(PHONES.stephen, "", { choiceId });
    await say(PHONES.stephen, "", { media: [jpg(before)] });
    await say(PHONES.stephen, "next");
    await say(PHONES.stephen, "finish");
    await say(PHONES.stephen, "", { media: [jpg(after)] });
    await say(PHONES.stephen, "done");
    const [{ jobId }] = (await db.select({ jobId: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.createdByCrewId, "crw_stephen"), eq(schema.jobs.status, "captured"))));

    await say(PHONES.stephen, "", { media: [{ buffer: vcard("Emily Hart", "+447700900104"), mimeType: "text/x-vcard" }] });
    expect((await lastOut(PHONES.stephen)).body).toBe("Thanks. The office will ask Emily how it went.");

    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.phone, "+447700900104"));
    expect(customer).toMatchObject({ tenantId: T, firstName: "Emily", lastName: "Hart", postcode: "SW15", area: "Putney" });
    expect(job).toMatchObject({ customerId: customer.id, status: "awaiting_testimonial" });
    const held = await lastOut("+447700900104");
    expect(held).toMatchObject({ status: "held", meta: { kind: "review_request", jobId } });
    expect(held.body).toContain("Hi Emily, it's Stephen at Thorburn Landscapes");
    expect((await jobCompletedTask(jobId)).runAt.getTime()).toBeLessThanOrEqual(Date.now());

    // The new customer can now opt out by replying STOP.
    await say("+447700900104", "STOP");
    const [optedOut] = await db.select().from(schema.customers).where(eq(schema.customers.id, customer.id));
    expect(optedOut.optedOut).toBe(true);
  });

  it("refuses a crew number as the homeowner and lets the crew try again", async () => {
    await say(PHONES.jake, "new job");
    for (const choiceId of ["svc:maintenance", "pc:SW4"]) await say(PHONES.jake, "", { choiceId });
    await say(PHONES.jake, "", { media: [jpg(before)] });
    await say(PHONES.jake, "next");
    await say(PHONES.jake, "finish");
    await say(PHONES.jake, "", { media: [jpg(after)] });
    await say(PHONES.jake, "done");
    await say(PHONES.jake, "07700 900002"); // Marco's number
    expect((await lastOut(PHONES.jake)).body).toContain("team member's number");
    const conv = await conversation(PHONES.jake);
    expect((conv.state as { step: string }).step).toBe("homeowner");
    await say(PHONES.jake, "skip");
    expect((await lastOut(PHONES.jake)).body).toContain("is with the office now");
  });

  it("ignores non-allow-listed attachments and URLs outside Twilio", async () => {
    await say(PHONES.marco, "", { media: [{ buffer: Buffer.from("%PDF-1.4"), mimeType: "application/pdf" }] });
    expect((await lastOut(PHONES.marco)).body).toContain("didn't come through");
    await say(PHONES.marco, "", { media: [{ url: "https://169.254.169.254/latest/meta-data", mimeType: "image/jpeg" }] });
    expect((await lastOut(PHONES.marco)).body).toContain("didn't come through");
  });
});

describe("isDuplicateProviderId", () => {
  it("only treats a unique violation as a duplicate; other insert errors are real failures", () => {
    expect(isDuplicateProviderId(Object.assign(new Error("dup"), { code: "23505", constraint: "messages_provider_uq" }))).toBe(true);
    expect(isDuplicateProviderId(new Error("wrapped", { cause: Object.assign(new Error("x"), { code: "23505" }) }))).toBe(true);
    expect(isDuplicateProviderId(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false);
    expect(isDuplicateProviderId(new Error("connection lost"))).toBe(false);
  });
});

describe("public-safe derivative", () => {
  it("auto-rotates, strips EXIF/GPS and caps at 2000px", async () => {
    const withExif = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#6b7" } })
      .jpeg()
      .withExif({ IFD0: { Make: "Phone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 25/1 0/1" } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const src = await sharp(withExif).metadata();
    expect(src.orientation).toBe(6);
    expect(src.exif?.toString("latin1")).toContain("Phone");
    const d = await makePublicDerivative(withExif);
    const meta = await sharp(d.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe("jpeg");
    // Orientation 6 = rotate 90°: portrait after auto-rotate, longest side 2000.
    expect({ w: d.width, h: d.height }).toEqual({ w: 1000, h: 2000 });
  });

  it("stores the original byte-for-byte", async () => {
    const db = await getDb();
    const [m] = await db.select().from(schema.media).where(eq(schema.media.kind, "image")).limit(1);
    expect((await getObject(m.storageKey)).equals(before)).toBe(true);
  });
});
