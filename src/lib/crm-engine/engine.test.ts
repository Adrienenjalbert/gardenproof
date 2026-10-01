import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import {
  approveAllAwaiting,
  approveScheduledMessage,
  dispatchDueMessages,
  editScheduledMessage,
  moveJobToStage,
  skipScheduledMessage,
} from "./index";
import { PH, TEN, seedCrmJob, seedCrmTenant, setTenantSettings } from "./test-fixtures";

// Only Date is faked: PGlite and timers keep running normally.
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T11:00:00Z"));
  await seedCrmTenant();
}, 120_000);
afterAll(() => vi.useRealTimers());
beforeEach(async () => {
  // Isolation between cases: digest off unless a test turns it on; routine auto-send off (safe mode default).
  await setTenantSettings({
    notifications: {
      instant: ["new_enquiry", "low_review", "customer_needs_owner", "quote_accepted"],
      digestHour: null,
      autoApproveAfterDays: 30,
    },
  });
  const db = await getDb();
  await db
    .update(schema.scheduledMessages)
    .set({ status: "cancelled" })
    .where(eq(schema.scheduledMessages.tenantId, TEN));
});

const at = (s: string) => new Date(s);
async function rows(jobId: string) {
  return (await getDb()).select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.jobId, jobId));
}
async function row(jobId: string, prefix: string) {
  return (await rows(jobId)).find((r) => r.ruleKey.startsWith(prefix))!;
}
async function messagesTo(phone: string) {
  return (await getDb()).select().from(schema.messages).where(eq(schema.messages.toNumber, phone));
}

describe("moveJobToStage", () => {
  it("records the change and schedules what the new stage needs", async () => {
    const job = await seedCrmJob({ stage: "site_visit", nextActionAt: null });
    const now = at("2026-09-24T11:00:00Z");
    const r = await moveJobToStage(job.id, "quoted", "owner", "Sent by email", {
      now,
    });
    expect(r.event).toMatchObject({
      fromStage: "site_visit",
      toStage: "quoted",
      actor: "owner",
      note: "Sent by email",
    });
    expect(r.job.stage).toBe("quoted");
    const f = await row(job.id, "quote_follow_up");
    expect(f).toMatchObject({
      status: "scheduled",
      trustTier: "quick_yes",
      audience: "customer",
      customerId: "crm_amelia",
    });
    expect(f.sendAt.toISOString()).toBe("2026-09-29T09:00:00.000Z");
  });

  it("cancels what no longer applies and is idempotent", async () => {
    const job = await seedCrmJob({ stage: "enquiry" });
    const now = at("2026-09-24T11:00:00Z");
    await moveJobToStage(job.id, "quoted", "owner", null, { now });
    await moveJobToStage(job.id, "booked", "owner", null, {
      now,
      at: at("2026-10-05T07:00:00Z"),
    });
    await moveJobToStage(job.id, "booked", "owner", null, { now });
    const all = await rows(job.id);
    expect(all.find((r) => r.ruleKey === "quote_follow_up")?.status).toBe("cancelled");
    expect(
      all
        .filter((r) => r.status === "scheduled")
        .map((r) => r.ruleKey)
        .sort(),
    ).toEqual(["booked_prep", "capture_before:2026-10-05", "start_crew:2026-10-05", "start_reminder:2026-10-05"]);
    const events = await (
      await getDb()
    )
      .select()
      .from(schema.jobStageEvents)
      .where(eq(schema.jobStageEvents.jobId, job.id));
    expect(events.map((e) => e.toStage)).toEqual(["quoted", "booked"]);
  });

  it("reschedules a moved visit and cancels the old reminders", async () => {
    const job = await seedCrmJob({ stage: "enquiry" });
    const now = at("2026-09-24T11:00:00Z");
    await moveJobToStage(job.id, "site_visit", "owner", null, {
      now,
      at: at("2026-09-26T09:00:00Z"),
    });
    await moveJobToStage(job.id, "site_visit", "owner", null, {
      now,
      at: at("2026-09-28T13:00:00Z"),
    });
    const all = await rows(job.id);
    expect(
      all
        .filter((r) => r.status === "scheduled")
        .map((r) => r.ruleKey)
        .sort(),
    ).toEqual(["site_visit_crew:2026-09-28", "site_visit_reminder:2026-09-28"]);
    expect(
      all
        .filter((r) => r.status === "cancelled")
        .map((r) => r.ruleKey)
        .sort(),
    ).toEqual(["site_visit_crew:2026-09-26", "site_visit_reminder:2026-09-26"]);
  });

  it("tells the owner instantly about a new enquiry that he didn't enter himself", async () => {
    const before = (await messagesTo(PH.stephen)).length;
    const job = await seedCrmJob({ stage: "enquiry" });
    await moveJobToStage(job.id, "enquiry", "customer", null, {
      now: at("2026-09-24T11:00:00Z"),
    });
    const owner = await messagesTo(PH.stephen);
    expect(owner.length).toBe(before + 1);
    expect(owner.at(-1)?.body).toContain("New enquiry from Amelia in Barnes");
    expect((await row(job.id, "enquiry_ack")).status).toBe("scheduled");
  });
});

describe("dispatchDueMessages", () => {
  it("holds routine customer messages for approval in safe mode, and sends crew notes at once", async () => {
    const job = await seedCrmJob({ stage: "enquiry" });
    const now = at("2026-09-24T11:00:00Z");
    await moveJobToStage(job.id, "site_visit", "owner", null, {
      now,
      at: at("2026-09-25T09:00:00Z"),
    });
    const s = await dispatchDueMessages(at("2026-09-24T17:00:00Z"), {
      digest: false,
    }); // 18:00 the evening before
    expect(s.awaiting).toBeGreaterThanOrEqual(1);
    const reminder = await row(job.id, "site_visit_reminder");
    expect(reminder.status).toBe("awaiting_approval");
    const [held] = await (
      await getDb()
    )
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, reminder.messageId!));
    expect(held.status).toBe("held");
    // Crew lead note (07:30 on the day) is not due yet; then it is, and goes straight out.
    expect((await row(job.id, "site_visit_crew")).status).toBe("scheduled");
    await dispatchDueMessages(at("2026-09-25T06:31:00Z"), { digest: false });
    const crew = await row(job.id, "site_visit_crew");
    expect(crew.status).toBe("sent");
    expect((await messagesTo(PH.marco)).at(-1)).toMatchObject({
      status: "sent",
      body: expect.stringContaining("Site visit today at 10:00: Amelia in Barnes (SW13 9AA)"),
    });
  });

  it("sends routine messages when the owner switched on auto-send", async () => {
    await setTenantSettings({
      autoSendRoutine: true,
      notifications: {
        instant: [],
        digestHour: null,
        autoApproveAfterDays: 30,
      },
    });
    const job = await seedCrmJob({ stage: "enquiry", customerId: "crm_tom" });
    await moveJobToStage(job.id, "enquiry", "owner", null, {
      now: at("2026-09-24T11:00:00Z"),
    });
    await dispatchDueMessages(at("2026-09-24T11:01:00Z"), { digest: false });
    const ack = await row(job.id, "enquiry_ack");
    expect(ack.status).toBe("sent");
    const [msg] = await (await getDb()).select().from(schema.messages).where(eq(schema.messages.id, ack.messageId!));
    expect(msg).toMatchObject({ status: "sent", toNumber: PH.tom });
    expect(msg.body).toContain("Hi Tom");
  });

  it("queues quick-yes messages and tells the owner once per batch", async () => {
    const a = await seedCrmJob({ stage: "enquiry" });
    const b = await seedCrmJob({ stage: "enquiry", customerId: "crm_tom" });
    const t0 = at("2026-09-10T11:00:00Z");
    await moveJobToStage(a.id, "quoted", "owner", null, { now: t0 });
    await moveJobToStage(b.id, "quoted", "owner", null, { now: t0 });
    const before = (await messagesTo(PH.stephen)).length;
    await dispatchDueMessages(at("2026-09-24T11:00:00Z"), { digest: false });
    expect((await row(a.id, "quote_follow_up")).status).toBe("awaiting_approval");
    expect((await row(b.id, "quote_follow_up")).status).toBe("awaiting_approval");
    const owner = await messagesTo(PH.stephen);
    expect(owner.length).toBe(before + 1);
    expect(owner.at(-1)?.body).toMatch(/^2 messages are ready to go/);
    expect(owner.at(-1)?.options.map((o) => o.id)).toEqual(["crm_send_all", "crm_open_app"]);
    // Running again does nothing new.
    await dispatchDueMessages(at("2026-09-24T11:02:00Z"), { digest: false });
    expect((await messagesTo(PH.stephen)).length).toBe(before + 1);

    // "Send all" sends both, releasing safe mode because the owner said yes.
    expect(await approveAllAwaiting(TEN, "owner", at("2026-09-24T12:00:00Z"))).toBe(2);
    const sent = (await messagesTo(PH.tom)).at(-1);
    expect(sent).toMatchObject({ status: "sent" });
    expect((await row(b.id, "quote_follow_up")).status).toBe("sent");
  });

  it("defers customer messages that fall due in quiet hours to 08:30", async () => {
    const job = await seedCrmJob({ stage: "enquiry" });
    await moveJobToStage(job.id, "quoted", "owner", null, {
      now: at("2026-09-10T11:00:00Z"),
    });
    const s = await dispatchDueMessages(at("2026-09-24T21:00:00Z"), {
      digest: false,
    }); // 22:00 BST
    expect(s.deferred).toBeGreaterThanOrEqual(1);
    const f = await row(job.id, "quote_follow_up");
    expect(f).toMatchObject({ status: "scheduled" });
    expect(f.sendAt.toISOString()).toBe("2026-09-25T07:30:00.000Z");
  });

  it("cancels messages for jobs that moved on without the engine", async () => {
    const job = await seedCrmJob({ stage: "enquiry" });
    await moveJobToStage(job.id, "quoted", "owner", null, {
      now: at("2026-09-10T11:00:00Z"),
    });
    await (await getDb()).update(schema.jobs).set({ stage: "lost" }).where(eq(schema.jobs.id, job.id));
    await dispatchDueMessages(at("2026-09-24T11:00:00Z"), { digest: false });
    expect((await row(job.id, "quote_follow_up")).status).toBe("cancelled");
  });

  it("sends a quick-yes automatically once the owner has earned it", async () => {
    await setTenantSettings({
      notifications: {
        instant: [],
        digestHour: null,
        autoApproveAfterDays: 30,
      },
    });
    const db = await getDb();
    const old = await seedCrmJob({ stage: "quoted" });
    await db.insert(schema.scheduledMessages).values({
      id: "sch_old_yes",
      tenantId: TEN,
      jobId: old.id,
      audience: "customer",
      ruleKey: "quote_follow_up",
      trustTier: "quick_yes",
      sendAt: at("2026-08-01T10:00:00Z"),
      status: "sent",
      createdAt: at("2026-08-01T10:00:00Z"),
    });
    const job = await seedCrmJob({ stage: "enquiry", customerId: "crm_tom" });
    await moveJobToStage(job.id, "quoted", "owner", null, {
      now: at("2026-09-10T11:00:00Z"),
    });
    await dispatchDueMessages(at("2026-09-24T11:00:00Z"), { digest: false });
    const f = await row(job.id, "quote_follow_up");
    expect(f.status).toBe("sent");
    await db
      .update(schema.scheduledMessages)
      .set({ status: "cancelled" })
      .where(eq(schema.scheduledMessages.id, "sch_old_yes"));
  });

  it("asks the owner about always-ask messages and leaves them out of Send all", async () => {
    const job = await seedCrmJob({ stage: "enquiry", team: "maintenance" });
    await moveJobToStage(job.id, "maintenance", "owner", null, {
      now: at("2025-10-20T10:00:00Z"),
      at: null,
    });
    await dispatchDueMessages(at("2026-09-24T11:00:00Z"), { digest: false });
    const renewal = await row(job.id, "maintenance_renewal");
    expect(renewal).toMatchObject({
      status: "awaiting_approval",
      trustTier: "always_ask",
    });
    expect(await approveAllAwaiting(TEN, "owner", at("2026-09-24T11:05:00Z"))).toBe(0);
    const out = await approveScheduledMessage(TEN, renewal.id, "owner", at("2026-09-24T11:06:00Z"));
    expect(out.status).toBe("sent");
  });

  it("asks for reviews through the testimonial flow so consent is recorded", async () => {
    const job = await seedCrmJob({ stage: "on_site", customerId: "crm_tom" });
    await moveJobToStage(job.id, "finished", "owner", null, {
      now: at("2026-09-22T15:00:00Z"),
    });
    await dispatchDueMessages(at("2026-09-24T11:00:00Z"), { digest: false });
    const req = await row(job.id, "review_request");
    expect(req.status).toBe("awaiting_approval");
    await approveScheduledMessage(TEN, req.id, "owner", at("2026-09-24T11:10:00Z"));
    const [t] = await (await getDb()).select().from(schema.testimonials).where(eq(schema.testimonials.jobId, job.id));
    expect(t.status).toBe("sent");
    const done = await row(job.id, "review_request");
    expect(done.status).toBe("sent");
    const [msg] = await (await getDb()).select().from(schema.messages).where(eq(schema.messages.id, done.messageId!));
    expect(msg.body).toContain(`/r/${t.token}`);
  });
});

describe("owner decisions", () => {
  it("approving at night waits for the morning; skip and edit change what goes", async () => {
    const job = await seedCrmJob({ stage: "enquiry", customerId: "crm_tom" });
    await moveJobToStage(job.id, "quoted", "owner", null, {
      now: at("2026-09-10T11:00:00Z"),
    });
    await dispatchDueMessages(at("2026-09-24T11:00:00Z"), { digest: false });
    const f = await row(job.id, "quote_follow_up");

    await editScheduledMessage(TEN, f.id, "Hi Tom, any thoughts on the quote? Stephen");
    expect((await row(job.id, "quote_follow_up")).body).toBe("Hi Tom, any thoughts on the quote? Stephen");

    const night = await approveScheduledMessage(TEN, f.id, "owner", at("2026-09-24T21:30:00Z"));
    expect(night.status).toBe("scheduled");
    expect(night.sendAt.toISOString()).toBe("2026-09-25T07:30:00.000Z");
    // In the morning the sweep sends it without asking again (the owner already said yes).
    await dispatchDueMessages(at("2026-09-25T07:31:00Z"), { digest: false });
    const sent = await row(job.id, "quote_follow_up");
    expect(sent.status).toBe("sent");
    const [msg] = await (await getDb()).select().from(schema.messages).where(eq(schema.messages.id, sent.messageId!));
    expect(msg).toMatchObject({
      status: "sent",
      body: "Hi Tom, any thoughts on the quote? Stephen",
    });

    const other = await seedCrmJob({ stage: "enquiry" });
    await moveJobToStage(other.id, "quoted", "owner", null, {
      now: at("2026-09-10T11:00:00Z"),
    });
    const g = await row(other.id, "quote_follow_up");
    await skipScheduledMessage(TEN, g.id);
    await dispatchDueMessages(at("2026-09-24T11:00:00Z"), { digest: false });
    expect((await row(other.id, "quote_follow_up")).status).toBe("skipped");
    // A skip sticks even if the job is re-planned.
    await moveJobToStage(other.id, "quoted", "owner", null, {
      now: at("2026-09-24T12:00:00Z"),
    });
    expect((await row(other.id, "quote_follow_up")).status).toBe("skipped");
  });

  it("refuses to edit the review request (fixed consent wording)", async () => {
    const job = await seedCrmJob({ stage: "on_site" });
    await moveJobToStage(job.id, "finished", "owner", null, {
      now: at("2026-09-24T11:00:00Z"),
    });
    const req = await row(job.id, "review_request");
    await expect(editScheduledMessage(TEN, req.id, "Hi, rate us!")).rejects.toThrow(/fixed wording/);
  });
});

describe("evening digest", () => {
  it("sends one summary per day at the owner's hour, with a Send all button", async () => {
    await setTenantSettings({
      notifications: {
        instant: [],
        digestHour: 18,
        autoApproveAfterDays: null,
      },
    });
    const job = await seedCrmJob({ stage: "enquiry", customerId: "crm_tom" });
    await moveJobToStage(job.id, "quoted", "owner", null, {
      now: at("2026-09-10T11:00:00Z"),
    });
    const enquiry = await seedCrmJob({ stage: "enquiry" });
    await moveJobToStage(enquiry.id, "enquiry", "customer", null, {
      now: at("2026-09-24T12:00:00Z"),
    }); // not instant → digest item
    const visit = await seedCrmJob({ stage: "enquiry" });
    await moveJobToStage(visit.id, "site_visit", "owner", null, {
      now: at("2026-09-24T12:00:00Z"),
      at: at("2026-09-25T09:00:00Z"),
    });

    const before = (await messagesTo(PH.stephen)).length;
    await dispatchDueMessages(at("2026-09-24T12:00:00Z")); // 13:00: before digest time; approvals wait for it
    expect((await messagesTo(PH.stephen)).length).toBe(before);

    const s = await dispatchDueMessages(at("2026-09-24T17:00:00Z")); // 18:00 BST
    expect(s.digests).toBe(1);
    const digest = (await messagesTo(PH.stephen)).at(-1)!;
    expect(digest.body).toMatch(/^Good evening Stephen\./);
    expect(digest.body).toContain("New enquiry from Amelia in Barnes");
    expect(digest.body).toContain("Quote follow-up to Tom");
    expect(digest.body).toContain("Site visit · Amelia at 10:00");
    expect(digest.options[0].id).toBe("crm_send_all");

    await dispatchDueMessages(at("2026-09-24T19:30:00Z"));
    expect((await messagesTo(PH.stephen)).length).toBe(before + 1);
    const sentDigests = await (
      await getDb()
    )
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.tenantId, TEN), eq(schema.events.type, "owner.digest_sent")));
    expect(sentDigests).toHaveLength(1);
  });
});
