import { and, desc, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { env } from "@/lib/config";
import { PHONES, T, seedJob, seedTenant } from "@/lib/bot/test-fixtures";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { approveHeldMessage, cancelHeldMessage } from "@/lib/messaging";
import { consentItems, consentWording } from "./consent";
import {
  TESTIMONIAL_TTL_MS,
  expireStaleTestimonials,
  getTestimonialView,
  recordReviewClick,
  requestTestimonial,
  submitTestimonial,
  withdrawConsent,
  withdrawConsentByToken,
} from "./index";

const enqueue = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/tasks/enqueue", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tasks/enqueue")>();
  return {
    ...mod,
    enqueueReadyForContent: (...args: Parameters<typeof mod.enqueueReadyForContent>) => {
      if (enqueue.fail) return Promise.reject(new Error("queue down"));
      return mod.enqueueReadyForContent(...args);
    },
  };
});

beforeAll(
  () =>
    seedTenant({
      proof: { whichRating: "4.9", whichUrl: "https://which.example/thorburn", googleReviewUrl: "https://g.page/r/thorburn/review" },
    }),
  120_000,
);
afterEach(() => {
  env.safeMode = true;
  env.twilio.reviewRequestTemplateSid = null;
  enqueue.fail = false;
});

async function db() {
  return getDb();
}
async function testimonialFor(jobId: string) {
  const [t] = await (await db()).select().from(schema.testimonials).where(eq(schema.testimonials.jobId, jobId));
  return t;
}
async function jobStatus(jobId: string) {
  const [j] = await (await db()).select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  return j.status;
}
async function lastMessageTo(phone: string) {
  const rows = await (await db()).select().from(schema.messages).where(eq(schema.messages.toNumber, phone));
  return rows[rows.length - 1];
}
async function tasksFor(type: string, key: "jobId" | "assetId", id: string) {
  return (await db())
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.type, type), sql`${schema.tasks.payload}->>${key} = ${id}`));
}
const contentTasks = (jobId: string) => tasksFor("pipeline.ready_for_content", "jobId", jobId);
async function requested() {
  const job = await seedJob();
  expect(await requestTestimonial(job.id)).toBe(true);
  return { job, t: await testimonialFor(job.id) };
}
const valid = {
  rating: 5,
  quote: "Tidy, on time and exactly what we pictured.",
  consentPhotos: true,
  consentArea: true,
  consentFirstName: false,
  consentQuote: true,
  maintenanceInterest: true,
};

describe("requestTestimonial", () => {
  it("creates a token, moves the job on and holds a warm message in safe mode, linked by meta", async () => {
    const { job, t } = await requested();
    expect(t.status).toBe("pending");
    expect(t.token).toHaveLength(24);
    expect(await jobStatus(job.id)).toBe("awaiting_testimonial");
    const msg = await lastMessageTo(PHONES.harriet);
    expect(msg.status).toBe("held");
    expect(msg.body).toContain("Hi Harriet, it's Stephen at Thorburn Landscapes");
    expect(msg.body).toContain(`${env.appUrl}/r/${t.token}`);
    expect(msg.meta).toEqual({ kind: "review_request", testimonialId: t.id, jobId: job.id });
  });

  it("uses the approved WhatsApp template when configured (same text, no photo)", async () => {
    env.twilio.reviewRequestTemplateSid = `HX${"b".repeat(32)}`;
    const { t } = await requested();
    const msg = await lastMessageTo(PHONES.harriet);
    expect(msg.meta).toMatchObject({
      testimonialId: t.id,
      template: { sid: `HX${"b".repeat(32)}`, variables: { "1": "Harriet", "2": "Stephen at Thorburn Landscapes", "3": `${env.appUrl}/r/${t.token}` } },
    });
    expect(msg.mediaUrls).toEqual([]);
    expect(msg.body).toContain(`${env.appUrl}/r/${t.token}`);
  });

  it("is idempotent per job", async () => {
    const { job } = await requested();
    expect(await requestTestimonial(job.id)).toBe(true);
    const rows = await (await db()).select().from(schema.testimonials).where(eq(schema.testimonials.jobId, job.id));
    expect(rows).toHaveLength(1);
  });

  it("returns false with no customer, no phone, or an opted-out customer", async () => {
    expect(await requestTestimonial((await seedJob({ customerId: null })).id)).toBe(false);
    expect(await requestTestimonial((await seedJob({ customerId: "cus_nophone" })).id)).toBe(false);
    const optedOut = await seedJob({ customerId: "cus_otto" });
    expect(await requestTestimonial(optedOut.id)).toBe(false);
    expect(await testimonialFor(optedOut.id)).toBeUndefined();
  });

  it("marks the request sent straight away when safe mode is off", async () => {
    env.safeMode = false;
    const { t } = await requested();
    expect(t.status).toBe("sent");
    expect(t.sentAt).toBeInstanceOf(Date);
  });

  it("starts the clock when the agency approves the held message", async () => {
    const { t } = await requested();
    const msg = await lastMessageTo(PHONES.harriet);
    await approveHeldMessage(msg.id);
    const after = await testimonialFor(t.jobId);
    expect(after.status).toBe("sent");
    expect(after.sentAt).toBeInstanceOf(Date);
  });

  it("queues content for the job if the agency cancels the request", async () => {
    const { job } = await requested();
    await cancelHeldMessage((await lastMessageTo(PHONES.harriet)).id);
    expect((await testimonialFor(job.id)).status).toBe("expired");
    expect(await contentTasks(job.id)).toHaveLength(1);
  });
});

describe("submitTestimonial", () => {
  it("validates rating, quote length and explicit consent answers", async () => {
    const { t } = await requested();
    const bad = await submitTestimonial(t.token, { rating: 0, quote: "x".repeat(281), consentPhotos: true });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reason).toBe("validation");
    expect(Object.keys(bad.fieldErrors ?? {})).toEqual(expect.arrayContaining(["rating", "quote", "consentArea", "consentFirstName"]));
    expect((await testimonialFor(t.jobId)).status).toBe("pending");
  });

  it("requires an answer on quoting when a happy homeowner wrote something", async () => {
    const { t } = await requested();
    const res = await submitTestimonial(t.token, { ...valid, consentQuote: undefined });
    expect(res).toMatchObject({ ok: false, reason: "validation", fieldErrors: { consentQuote: expect.any(String) } });
  });

  it("stores answers with the exact consent wording (incl. the quote), logs consent and queues content", async () => {
    const { t, job } = await requested();
    const res = await submitTestimonial(t.token, valid);
    expect(res).toEqual({
      ok: true,
      rating: 5,
      alreadySubmitted: false,
      reviewLinks: { google: "https://g.page/r/thorburn/review", which: "https://which.example/thorburn" },
    });
    const saved = await testimonialFor(job.id);
    expect(saved).toMatchObject({ status: "responded", rating: 5, consentPhotos: true, consentArea: true, consentFirstName: false, consentQuote: true, maintenanceInterest: true });
    const items = consentItems("Thorburn Landscapes", "Wimbledon");
    expect(saved.consentWording).toContain(`[YES] ${items[0].title}: ${items[0].statement}`);
    expect(saved.consentWording).toContain(`[NO] ${items[2].title}: ${items[2].statement}`);
    expect(saved.consentWording).toContain(`[YES] Your words: Thorburn Landscapes may quote my words above`);
    expect(saved.consentWording).toContain("Never my street or house number");
    const [ev] = await (await db())
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.type, "consent.recorded"), eq(schema.events.entityId, t.id)));
    expect(ev.data).toMatchObject({ photos: true, area: true, firstName: false, quote: true });
    expect(await contentTasks(job.id)).toHaveLength(1);
  });

  it("records the quote as NOT consented when there is no quote, or the rating is low", async () => {
    const a = await requested();
    await submitTestimonial(a.t.token, { ...valid, quote: "  ", consentQuote: undefined });
    const savedA = await testimonialFor(a.job.id);
    expect(savedA.consentQuote).toBe(false);
    expect(savedA.consentWording).toContain("[NO] Your words:");
    expect(savedA.consentWording).toContain("(not asked: no public comment given)");

    const b = await requested();
    await submitTestimonial(b.t.token, { ...valid, rating: 3, consentQuote: true });
    expect((await testimonialFor(b.job.id)).consentQuote).toBe(false);
  });

  it("routes low ratings privately: no review links, owner notified", async () => {
    const { t } = await requested();
    const res = await submitTestimonial(t.token, { ...valid, rating: 2, quote: "Left some mess by the gate." });
    expect(res.ok && res.reviewLinks).toEqual({ google: null, which: null });
    const owner = await lastMessageTo(PHONES.stephen);
    expect(owner.body).toContain("rated it 2/5");
    expect(owner.body).toContain("Left some mess by the gate.");
    expect(owner.status).toBe("sent");
    expect(await recordReviewClick(t.token, "google")).toBeNull();
  });

  it("holds a low rating for the evening digest instead when Stephen turned instant low-review alerts off", async () => {
    await (await db())
      .update(schema.tenants)
      .set({ settings: { notifications: { instant: ["new_enquiry", "customer_needs_owner", "quote_accepted"], digestHour: 18, autoApproveAfterDays: 30 } } })
      .where(eq(schema.tenants.id, T));
    try {
      const { t } = await requested();
      const before = await lastMessageTo(PHONES.stephen);
      await submitTestimonial(t.token, { ...valid, rating: 2, quote: "Bins left out." });
      // Nothing new went straight to WhatsApp...
      expect(await lastMessageTo(PHONES.stephen)).toEqual(before);
      // ...it's queued for the digest instead.
      const [ev] = await (await db())
        .select()
        .from(schema.events)
        .where(and(eq(schema.events.tenantId, T), eq(schema.events.type, "owner.digest_item")))
        .orderBy(desc(schema.events.createdAt))
        .limit(1);
      expect((ev.data as { kind: string; text: string }).kind).toBe("low_review");
      expect((ev.data as { kind: string; text: string }).text).toContain("rated it 2/5");
    } finally {
      await (await db()).update(schema.tenants).set({ settings: {} }).where(eq(schema.tenants.id, T));
    }
  });

  it("keeps the answer and the content task atomic: if queueing fails, nothing is recorded", async () => {
    const { t } = await requested();
    enqueue.fail = true;
    await expect(submitTestimonial(t.token, valid)).rejects.toThrow(/queue down/);
    expect((await testimonialFor(t.jobId)).status).toBe("pending");
    enqueue.fail = false;
    expect(await submitTestimonial(t.token, valid)).toMatchObject({ ok: true, alreadySubmitted: false });
  });

  it("is idempotent and rejects bad or expired tokens", async () => {
    const { t } = await requested();
    await submitTestimonial(t.token, valid);
    const again = await submitTestimonial(t.token, { ...valid, rating: 1 });
    expect(again).toMatchObject({ ok: true, alreadySubmitted: true, rating: 5 });
    expect(await contentTasks(t.jobId)).toHaveLength(1);
    expect(await submitTestimonial("nope", valid)).toMatchObject({ ok: false, reason: "invalid" });

    const other = await requested();
    await (await db()).update(schema.testimonials).set({ status: "expired" }).where(eq(schema.testimonials.id, other.t.id));
    expect(await submitTestimonial(other.t.token, valid)).toMatchObject({ ok: false, reason: "expired" });
  });

  it("records review clicks for happy homeowners", async () => {
    const { t } = await requested();
    await submitTestimonial(t.token, valid);
    expect(await recordReviewClick(t.token, "which")).toBe("https://which.example/thorburn");
    expect((await testimonialFor(t.jobId)).reviewLinkClicked).toBe("which");
  });
});

describe("consent wording", () => {
  it("is a single source: four statements, the quote one naming the words", () => {
    const items = consentItems("Thorburn Landscapes", null);
    expect(items.map((i) => i.key)).toEqual(["consentPhotos", "consentArea", "consentFirstName", "consentQuote"]);
    const text = consentWording("Thorburn Landscapes", null, { consentPhotos: true, consentArea: false, consentFirstName: false, consentQuote: true });
    expect(text.split("\n")).toHaveLength(5);
    expect(text).toContain("the neighbourhood");
    expect(text).toContain("open this link again");
  });
});

describe("expireStaleTestimonials", () => {
  const setSentAt = async (id: string, at: number) =>
    (await db()).update(schema.testimonials).set({ sentAt: new Date(at) }).where(eq(schema.testimonials.id, id));

  it("expires links unanswered for 48h and queues content for the job", async () => {
    env.safeMode = false;
    const stale = await requested();
    const fresh = await requested();
    const now = new Date();
    await setSentAt(stale.t.id, now.getTime() - TESTIMONIAL_TTL_MS - 60_000);
    await setSentAt(fresh.t.id, now.getTime() - TESTIMONIAL_TTL_MS + 60_000);
    const n = await expireStaleTestimonials(now);
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await testimonialFor(stale.job.id)).status).toBe("expired");
    expect((await testimonialFor(fresh.job.id)).status).toBe("sent");
    expect(await contentTasks(stale.job.id)).toHaveLength(1);
    expect(await contentTasks(fresh.job.id)).toHaveLength(0);
  });

  it("only marks expired once the content task is queued (a failed run is retried next sweep)", async () => {
    env.safeMode = false;
    const stale = await requested();
    const now = new Date();
    await setSentAt(stale.t.id, now.getTime() - TESTIMONIAL_TTL_MS - 60_000);
    enqueue.fail = true;
    await expect(expireStaleTestimonials(now)).rejects.toThrow(/queue down/);
    expect((await testimonialFor(stale.job.id)).status).toBe("sent");
    enqueue.fail = false;
    await expireStaleTestimonials(now);
    expect((await testimonialFor(stale.job.id)).status).toBe("expired");
    expect(await contentTasks(stale.job.id)).toHaveLength(1);
  });

  it("shows a lapsed link as expired even before the sweep runs", async () => {
    env.safeMode = false;
    const { t } = await requested();
    await setSentAt(t.id, Date.now() - TESTIMONIAL_TTL_MS - 1000);
    expect((await getTestimonialView(t.token))?.state).toBe("expired");
    expect(await submitTestimonial(t.token, valid)).toMatchObject({ ok: false, reason: "expired" });
  });
});

describe("withdrawConsent", () => {
  async function asset(jobId: string, status: "draft" | "in_review" | "approved" | "published" | "rejected") {
    const [row] = await (await db())
      .insert(schema.assets)
      .values({ id: `ast_${Math.random().toString(36).slice(2, 10)}`, tenantId: T, jobId, type: "social_pack", status, title: "x", content: {} })
      .returning();
    return row;
  }
  const assetStatus = async (id: string) => (await (await db()).select().from(schema.assets).where(eq(schema.assets.id, id)))[0].status;

  it("clears every consent flag, rejects unpublished assets, queues takedowns and tells the owner", async () => {
    const { t, job } = await requested();
    await submitTestimonial(t.token, valid);
    const draft = await asset(job.id, "in_review");
    const approved = await asset(job.id, "approved");
    const live = await asset(job.id, "published");
    const old = await asset(job.id, "rejected");

    const res = await withdrawConsent(t.id, "agency", "Asked by phone");
    expect(res).toMatchObject({ alreadyWithdrawn: false, unpublishQueued: [live.id] });
    expect(res.rejected.sort()).toEqual([draft.id, approved.id].sort());

    const saved = await testimonialFor(job.id);
    expect(saved).toMatchObject({ consentPhotos: false, consentArea: false, consentFirstName: false, consentQuote: false });
    expect(saved.withdrawnAt).toBeInstanceOf(Date);
    expect(saved.consentWording).toContain("[YES] Photos"); // evidence of what was agreed is kept
    expect(await assetStatus(draft.id)).toBe("rejected");
    expect(await assetStatus(live.id)).toBe("published"); // taken down by the unpublish task
    expect(await assetStatus(old.id)).toBe("rejected");
    const unpublish = await tasksFor("asset.unpublish", "assetId", live.id);
    expect(unpublish).toHaveLength(1);
    expect(unpublish[0].payload).toMatchObject({ reason: "Asked by phone" });

    const [ev] = await (await db()).select().from(schema.events).where(and(eq(schema.events.type, "consent.withdrawn"), eq(schema.events.entityId, t.id)));
    expect(ev.actor).toBe("agency");
    expect(ev.data).toMatchObject({ previous: { photos: true, area: true, quote: true }, now: { photos: false } });
    expect((await lastMessageTo(PHONES.stephen)).body).toContain("Consent withdrawn");
  });

  it("is idempotent: a second call changes nothing and queues nothing new", async () => {
    const { t, job } = await requested();
    await submitTestimonial(t.token, valid);
    const live = await asset(job.id, "published");
    await withdrawConsent(t.id, "agency");
    const again = await withdrawConsent(t.id, "agency");
    expect(again.alreadyWithdrawn).toBe(true);
    expect(await tasksFor("asset.unpublish", "assetId", live.id)).toHaveLength(1);
    const evs = await (await db()).select().from(schema.events).where(and(eq(schema.events.type, "consent.withdrawn"), eq(schema.events.entityId, t.id)));
    expect(evs).toHaveLength(1);
  });

  it("works from the homeowner's link, and the page view reflects it", async () => {
    const { t } = await requested();
    expect(await withdrawConsentByToken(t.token)).toBeNull(); // nothing answered yet
    await submitTestimonial(t.token, valid);
    expect(await getTestimonialView(t.token)).toMatchObject({ state: "responded", canWithdraw: true, withdrawn: false });
    const res = await withdrawConsentByToken(t.token);
    expect(res?.alreadyWithdrawn).toBe(false);
    expect(await getTestimonialView(t.token)).toMatchObject({ canWithdraw: false, withdrawn: true });
  });
});

describe("view model", () => {
  it("returns what the homeowner page needs, and null for unknown tokens", async () => {
    const { t } = await requested();
    const view = await getTestimonialView(t.token);
    expect(view).toMatchObject({ state: "open", businessName: "Thorburn Landscapes", firstName: "Harriet", area: "Wimbledon", logoPath: THORBURN_CONFIG.brand.logoPath, canWithdraw: false });
    expect(await getTestimonialView("x")).toBeNull();
  });
});
