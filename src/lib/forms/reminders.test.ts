import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { PHONES, T, seedTenant } from "@/lib/bot/test-fixtures";
import { isQuietHours, londonHour, reminderText, sendFormReminders } from "./reminders";
import { completeForm, createFormLink, saveAnswer } from "./store";

beforeAll(() => seedTenant(), 120_000);
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

const H = 3_600_000;
/** Monday 28 Sept 2026, 10:00 in London (BST = UTC+1). */
const T0 = new Date("2026-09-28T09:00:00Z");
let seq = 200;

async function startedForm(opts: { phone?: string | null; customerId?: string } = {}) {
  const phone = opts.phone === undefined ? `+4477009${String(++seq).padStart(5, "0")}` : opts.phone;
  const link = await createFormLink({ tenantId: T, kind: "enquiry", customerId: opts.customerId, prefill: phone ? { firstName: "Priya", phone } : undefined });
  await saveAnswer(link.token, "services", ["planting"]);
  await saveAnswer(link.token, "size", "small");
  const db = await getDb();
  await db.update(schema.formResponses).set({ updatedAt: T0 }).where(eq(schema.formResponses.token, link.token));
  return { ...link, phone };
}

async function sentTo(phone: string) {
  const db = await getDb();
  return db.select().from(schema.messages).where(and(eq(schema.messages.toNumber, phone), eq(schema.messages.direction, "out")));
}

async function ownerNotices(formId: string) {
  return (await sentTo(PHONES.stephen)).filter((m) => (m.meta as { formId?: string }).formId === formId);
}

async function sweepAt(hoursAfterT0: number) {
  vi.setSystemTime(new Date(T0.getTime() + hoursAfterT0 * H));
  return sendFormReminders(new Date());
}

describe("quiet hours", () => {
  it("uses London time across the clock change", () => {
    expect(londonHour(new Date("2026-07-01T19:30:00Z"))).toBe(20); // BST
    expect(londonHour(new Date("2026-12-01T19:30:00Z"))).toBe(19); // GMT
    expect(isQuietHours(new Date("2026-07-01T19:30:00Z"))).toBe(true);
    expect(isQuietHours(new Date("2026-07-01T06:59:00Z"))).toBe(true); // 07:59 BST
    expect(isQuietHours(new Date("2026-07-01T07:00:00Z"))).toBe(false);
    expect(isQuietHours(new Date("2026-12-01T07:59:00Z"))).toBe(true);
  });
});

describe("sendFormReminders", () => {
  it("nudges at 24h and 72h after the last answer, tells the owner once, then stops", async () => {
    const f = await startedForm();
    await sweepAt(23);
    expect(await sentTo(f.phone!)).toHaveLength(0);

    await sweepAt(24);
    await sweepAt(24.5); // hourly re-run: nothing twice
    let msgs = await sentTo(f.phone!);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ status: "held", meta: { kind: "form_reminder", reminder: 1, formId: f.id } }); // safe mode holds customer messages
    expect(msgs[0].body).toBe(
      `Hi Priya, pick up where you left off with your garden enquiry for Thorburn Landscapes: 7 questions left. Everything you've answered is saved.\n${f.url}?welcome`,
    );

    await sweepAt(71);
    expect(await sentTo(f.phone!)).toHaveLength(1);
    await sweepAt(72);
    msgs = await sentTo(f.phone!);
    expect(msgs).toHaveLength(2);
    expect(msgs[1].body).toMatch(/^Hi Priya, a last gentle nudge about your garden enquiry .* We won't remind you again\./);

    await sweepAt(95);
    expect(await ownerNotices(f.id)).toHaveLength(0);
    await sweepAt(96);
    await sweepAt(97);
    const owner = await ownerNotices(f.id);
    expect(owner).toHaveLength(1);
    expect(owner[0]).toMatchObject({ status: "sent", meta: { kind: "form_abandoned" } });
    expect(owner[0].body).toContain(`Priya (${f.phone}) started a garden enquiry but didn't finish`);
    expect(owner[0].body).toContain("Work: Planting schemes");

    await sweepAt(300);
    expect(await sentTo(f.phone!)).toHaveLength(2);
    expect(await ownerNotices(f.id)).toHaveLength(1);
  });

  it("waits from the latest answer: coming back resets the clock", async () => {
    const f = await startedForm();
    await sweepAt(24);
    const db = await getDb();
    await db.update(schema.formResponses).set({ updatedAt: new Date(T0.getTime() + 30 * H) }).where(eq(schema.formResponses.id, f.id));
    await sweepAt(72); // only 42h since they were last here
    expect(await sentTo(f.phone!)).toHaveLength(1);
    await sweepAt(102);
    expect(await sentTo(f.phone!)).toHaveLength(2);
  });

  it("never sends between 20:00 and 08:00 London time; the morning run catches up", async () => {
    const f = await startedForm();
    await sweepAt(34); // Tue 19:00 UTC = 20:00 BST
    await sweepAt(44); // Wed 05:00 UTC = 06:00 BST
    expect(await sentTo(f.phone!)).toHaveLength(0);
    await sweepAt(47); // 09:00 BST
    expect(await sentTo(f.phone!)).toHaveLength(1);
  });

  it("stops for opted-out people and for finished forms, and skips forms with no phone", async () => {
    const optedOut = await startedForm({ phone: PHONES.otto }); // cus_otto opted out
    const done = await startedForm();
    await saveAnswer(done.token, "budget", "guidance");
    await saveAnswer(done.token, "style", null);
    await saveAnswer(done.token, "timing", { choice: "planning" });
    await saveAnswer(done.token, "photos", null);
    await saveAnswer(done.token, "postcode", "SW19 5AB", { fetchImpl: (async () => Response.json({ status: 200, result: { postcode: "SW19 5AB", outcode: "SW19", admin_district: "Merton" } })) as unknown as typeof fetch });
    await saveAnswer(done.token, "contact", { firstName: "Priya", phone: done.phone!, consent: true });
    await saveAnswer(done.token, "callTime", { days: ["saturday"], windows: ["afternoon"] });
    await completeForm(done.token);
    const anonymous = await startedForm({ phone: null });

    const summary = await sweepAt(24);
    expect(await sentTo(PHONES.otto)).toHaveLength(0);
    expect(await sentTo(done.phone!)).toHaveLength(0);
    const db = await getDb();
    const [o] = await db.select().from(schema.formResponses).where(eq(schema.formResponses.id, optedOut.id));
    expect(o.remindersSent).toBe(3); // closed for good
    const [a] = await db.select().from(schema.formResponses).where(eq(schema.formResponses.id, anonymous.id));
    expect(a.remindersSent).toBe(0);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
  });

  it("leaves untouched links alone (only people who started get 'pick up where you left off')", async () => {
    const phone = "+447700900299";
    const link = await createFormLink({ tenantId: T, kind: "project_brief", prefill: { firstName: "Ann", phone } });
    const db = await getDb();
    await db.update(schema.formResponses).set({ updatedAt: T0 }).where(eq(schema.formResponses.id, link.id));
    await sweepAt(24);
    await sweepAt(72);
    expect(await sentTo(phone)).toHaveLength(0);
  });

  it("closes long-forgotten forms quietly instead of nudging about them", async () => {
    const f = await startedForm();
    await sweepAt(24 * 11);
    expect(await sentTo(f.phone!)).toHaveLength(0);
  });
});

describe("reminderText", () => {
  it("reads naturally at every count", () => {
    const base = { firstName: null, business: "Thorburn Landscapes", noun: "your project brief", url: "https://x/f/t?welcome" };
    expect(reminderText(1, { ...base, remaining: 1 })).toBe("Hi there, pick up where you left off with your project brief for Thorburn Landscapes: 1 question left. Everything you've answered is saved.\nhttps://x/f/t?welcome");
    expect(reminderText(2, { ...base, remaining: 0 })).toContain("(it's ready to send)");
  });
});
