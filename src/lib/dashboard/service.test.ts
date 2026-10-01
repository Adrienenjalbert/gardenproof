import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { THORBURN_CONFIG } from "@/lib/tenant";

// Publishing is queued by the pipeline (F3); here we only check the dashboard hands off to it.
const pipeline = vi.hoisted(() => ({
  onAssetApproved: vi.fn<(id: string) => Promise<{ id: string; deduped: boolean }>>(async () => ({ id: "tsk_x", deduped: false })),
}));
vi.mock("@/lib/pipeline", () => pipeline);
const customers = vi.hoisted(() => {
  class CustomerError extends Error {}
  return { CustomerError, attachCustomerToJob: vi.fn(async () => ({ created: true, testimonialRequested: true })) };
});
vi.mock("@/lib/customers", () => customers);
const testimonials = vi.hoisted(() => ({ withdrawConsent: vi.fn(async () => ({})) }));
vi.mock("@/lib/testimonials", () => testimonials);
const messaging = vi.hoisted(() => ({
  approveHeldMessage: vi.fn<(id: string, actor?: string) => Promise<{ status: string }>>(async () => ({ status: "sent" })),
  cancelHeldMessage: vi.fn<(id: string, actor?: string) => Promise<{ status: string }>>(async () => ({ status: "cancelled" })),
}));
vi.mock("@/lib/messaging", () => messaging);

import {
  DashboardError,
  approveAsset,
  approveMessage,
  attachHomeowner,
  bulkApprove,
  clearMediaPrivacy,
  keepMediaWithheld,
  regenerateAsset,
  rejectAsset,
  rerenderVideo,
  retryFailedTask,
  runContentGeneration,
  saveAssetContent,
  setHeroMedia,
  withdrawTestimonialConsent,
} from "./service";
import { KEPT_WITHHELD_TAG } from "./media-privacy";

const T = "ten_thorburn";
const VIDEO = { template: "reveal", ratio: "9:16", hook: "Circle-cut sandstone", props: {}, durationSec: null };
const ok = [{ id: "consent.photos", ok: true, message: "ok" }];

async function resetAssets() {
  const db = await getDb();
  await db.delete(schema.events);
  await db.delete(schema.assets);
  await db.insert(schema.assets).values([
    { id: "a_ok", tenantId: T, jobId: "job_1", type: "video", status: "in_review", title: "ok", content: VIDEO, checks: ok },
    {
      id: "a_consent",
      tenantId: T,
      jobId: "job_1",
      type: "video",
      status: "in_review",
      title: "blocked",
      content: VIDEO,
      checks: [{ id: "consent.first_name", ok: false, message: "no first-name consent" }],
    },
    {
      id: "a_lint",
      tenantId: T,
      jobId: "job_1",
      type: "video",
      status: "in_review",
      title: "lint",
      content: VIDEO,
      checks: [{ id: "limits.hook", ok: false, message: "long hook" }],
    },
    {
      id: "a_privacy",
      tenantId: T,
      jobId: "job_1",
      type: "video",
      status: "in_review",
      title: "privacy",
      content: VIDEO,
      checks: [{ id: "privacy", ok: false, message: "Mentions a street address" }],
    },
    {
      id: "a_which",
      tenantId: T,
      jobId: "job_1",
      type: "video",
      status: "in_review",
      title: "which",
      content: VIDEO,
      checks: [...ok, { id: "which-rating", ok: false, message: "Confirm the Which? rating is current" }],
    },
  ]);
}

beforeAll(async () => {
  const db = await getDb();
  await db.insert(schema.tenants).values({ id: T, slug: "thorburn", name: "Thorburn Landscapes", config: THORBURN_CONFIG });
  await db.insert(schema.tenants).values({ id: "ten_other", slug: "other", name: "Other", config: THORBURN_CONFIG });
  await db.insert(schema.jobs).values([
    { id: "job_1", tenantId: T, code: "TL-1111", status: "in_review" },
    { id: "job_cap", tenantId: T, code: "TL-2222", status: "capturing" },
  ]);
  await db.insert(schema.media).values([
    { id: "m1", tenantId: T, jobId: "job_1", stage: "after", kind: "image", storageKey: "k1", isHero: true },
    { id: "m2", tenantId: T, jobId: "job_1", stage: "after", kind: "image", storageKey: "k2" },
    { id: "m3", tenantId: T, jobId: "job_1", stage: "before", kind: "image", storageKey: "k3", isHero: true },
    { id: "m_blur", tenantId: T, jobId: "job_1", stage: "after", kind: "image", storageKey: "k4", publicKey: "k4.public.jpg", qualityNotes: "needs blur (face at window)" },
    { id: "m_audio", tenantId: T, jobId: "job_1", stage: "after", kind: "audio", storageKey: "k5.ogg" },
  ]);
}, 120_000); // first getDb() boots PGlite and runs migrations

beforeEach(async () => {
  vi.clearAllMocks();
  await resetAssets();
});

async function asset(id: string) {
  const db = await getDb();
  const [a] = await db.select().from(schema.assets).where(eq(schema.assets.id, id));
  return a;
}

describe("approveAsset", () => {
  it("refuses when a privacy check failed", async () => {
    await expect(approveAsset("a_privacy")).rejects.toThrow(/privacy check failed — Mentions a street address/);
    expect(pipeline.onAssetApproved).not.toHaveBeenCalled();
  });

  it("approves, logs an agency event and hands off to publishing", async () => {
    const r = await approveAsset("a_ok");
    expect(r.publishError).toBeNull();
    expect((await asset("a_ok")).status).toBe("approved");
    expect(pipeline.onAssetApproved).toHaveBeenCalledWith("a_ok");
    const db = await getDb();
    const ev = await db.select().from(schema.events).where(eq(schema.events.entityId, "a_ok"));
    expect(ev).toEqual([expect.objectContaining({ type: "asset.approved", actor: "agency" })]);
  });

  it("refuses when a consent check failed", async () => {
    await expect(approveAsset("a_consent")).rejects.toThrow(/consent/i);
    expect((await asset("a_consent")).status).toBe("in_review");
    expect(pipeline.onAssetApproved).not.toHaveBeenCalled();
  });

  it("keeps the approval and reports when publishing couldn't be queued", async () => {
    pipeline.onAssetApproved.mockRejectedValueOnce(new Error("DB unavailable"));
    const r = await approveAsset("a_ok");
    expect(r).toMatchObject({ status: "approved", publishError: "DB unavailable" });
  });

  it("rejects unknown assets", async () => {
    await expect(approveAsset("nope")).rejects.toBeInstanceOf(DashboardError);
  });
});

describe("bulkApprove", () => {
  it("only approves assets whose checks all pass and says why each other one was skipped", async () => {
    const r = await bulkApprove(["a_ok", "a_consent", "a_lint", "a_which", "a_privacy", "nope"]);
    expect(r.approved.map((a) => a.assetId)).toEqual(["a_ok"]);
    expect(r.skipped).toEqual([
      { assetId: "a_consent", title: "blocked", reason: "no first-name consent" },
      { assetId: "a_lint", title: "lint", reason: "long hook" },
      { assetId: "a_which", title: "which", reason: "Confirm the Which? rating is current" },
      { assetId: "a_privacy", title: "privacy", reason: "Mentions a street address" },
      { assetId: "nope", title: "nope", reason: "not found" },
    ]);
    expect((await asset("a_which")).status).toBe("in_review");
  });
});

describe("background work is queued, never run inline", () => {
  async function tasks() {
    const db = await getDb();
    return db.select().from(schema.tasks);
  }
  beforeEach(async () => {
    const db = await getDb();
    await db.delete(schema.tasks);
  });

  it("queues content generation once, however many clicks", async () => {
    const a = await runContentGeneration("job_1");
    const b = await runContentGeneration("job_1");
    expect(a.deduped).toBe(false);
    expect(b).toEqual({ taskId: a.taskId, deduped: true });
    expect(await tasks()).toEqual([
      expect.objectContaining({ type: "pipeline.ready_for_content", payload: { jobId: "job_1" }, tenantId: T, status: "queued" }),
    ]);
    await expect(runContentGeneration("job_cap")).rejects.toThrow(/still capturing/);
  });

  it("queues regeneration with the operator's note and video re-renders", async () => {
    await regenerateAsset("a_ok", "Shorter hook");
    await rerenderVideo("a_ok");
    const rows = await tasks();
    expect(rows.map((t) => [t.type, t.payload])).toEqual(
      expect.arrayContaining([
        ["content.regenerate", { assetId: "a_ok", instructions: "Shorter hook" }],
        ["video.render_asset", { assetId: "a_ok" }],
      ]),
    );
  });

  it("retries only this tenant's failed tasks", async () => {
    const db = await getDb();
    await db.insert(schema.tasks).values([
      { id: "tsk_failed", tenantId: T, type: "asset.publish", payload: { assetId: "a_ok" }, status: "failed", attempts: 3, lastError: "WP 502" },
      { id: "tsk_running", tenantId: T, type: "asset.publish", payload: { assetId: "a_lint" }, status: "running", attempts: 1 },
      { id: "tsk_other", tenantId: "ten_other", type: "asset.publish", payload: { assetId: "x" }, status: "failed" },
    ]);
    await retryFailedTask("tsk_failed");
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, "tsk_failed"));
    expect(row).toMatchObject({ status: "queued", attempts: 0 });
    await expect(retryFailedTask("tsk_running")).rejects.toThrow(/running, not failed/);
    await expect(retryFailedTask("tsk_other")).rejects.toThrow(/not found/);
    const ev = await db.select().from(schema.events).where(eq(schema.events.type, "task.retried"));
    expect(ev).toEqual([expect.objectContaining({ entityId: "tsk_failed", actor: "agency" })]);
  });
});

describe("photo privacy decisions (P0-2)", () => {
  async function media(id: string) {
    const db = await getDb();
    const [m] = await db.select().from(schema.media).where(eq(schema.media.id, id));
    return m;
  }
  it("clears a flagged photo and logs media.privacy_cleared as agency", async () => {
    await clearMediaPrivacy("m_blur");
    expect((await media("m_blur")).privacyClearedAt).toBeInstanceOf(Date);
    const db = await getDb();
    const ev = await db.select().from(schema.events).where(eq(schema.events.type, "media.privacy_cleared"));
    expect(ev).toEqual([
      expect.objectContaining({ entity: "media", entityId: "m_blur", actor: "agency", data: expect.objectContaining({ jobId: "job_1" }) }),
    ]);
  });
  it("keeps it withheld (undoing a clearance) and refuses non-photos", async () => {
    await clearMediaPrivacy("m_blur");
    await keepMediaWithheld("m_blur");
    const m = await media("m_blur");
    expect(m.privacyClearedAt).toBeNull();
    expect(m.tags).toContain(KEPT_WITHHELD_TAG);
    await clearMediaPrivacy("m_blur");
    expect((await media("m_blur")).tags).not.toContain(KEPT_WITHHELD_TAG);
    await expect(clearMediaPrivacy("m_audio")).rejects.toThrow(/Only photos/);
  });
});

describe("homeowner & consent", () => {
  it("attaches a homeowner through the customers module", async () => {
    await attachHomeowner("job_1", { firstName: "Harriet", phone: "07700 900123" });
    expect(customers.attachCustomerToJob).toHaveBeenCalledWith("job_1", { firstName: "Harriet", phone: "07700 900123" }, "agency");
    customers.attachCustomerToJob.mockRejectedValueOnce(new customers.CustomerError("That doesn't look like a mobile number."));
    await expect(attachHomeowner("job_1", { firstName: "H", phone: "01234" })).rejects.toBeInstanceOf(DashboardError);
  });

  it("withdraws consent once, via the testimonials module", async () => {
    const db = await getDb();
    await db.insert(schema.testimonials).values([
      { id: "t_live", tenantId: T, jobId: "job_1", token: "tok_live", status: "responded" },
      { id: "t_gone", tenantId: T, jobId: "job_1", token: "tok_gone", status: "responded", withdrawnAt: new Date() },
    ]);
    await withdrawTestimonialConsent("t_live", "Asked by phone");
    expect(testimonials.withdrawConsent).toHaveBeenCalledWith("t_live", "agency", "Asked by phone");
    await expect(withdrawTestimonialConsent("t_gone", undefined)).rejects.toThrow(/already withdrawn/);
  });
});

describe("rejectAsset", () => {
  it("stores the note and logs it", async () => {
    await rejectAsset("a_ok", "Wrong pergola");
    const a = await asset("a_ok");
    expect(a).toMatchObject({ status: "rejected", reviewNotes: "Wrong pergola" });
  });
});

describe("saveAssetContent", () => {
  it("validates, bumps the version and returns rejected assets to review", async () => {
    await rejectAsset("a_ok", "fix hook");
    const saved = await saveAssetContent("a_ok", { ...VIDEO, hook: "New hook" }, 1);
    expect(saved).toMatchObject({ version: 2, status: "in_review" });
    expect(saved.content.hook).toBe("New hook");
  });
  it("rejects invalid content and stale versions", async () => {
    await expect(saveAssetContent("a_ok", { ...VIDEO, ratio: "4:5" }, 1)).rejects.toThrow(/ratio/);
    await expect(saveAssetContent("a_ok", VIDEO, 7)).rejects.toThrow(/changed since/);
    expect((await asset("a_ok")).version).toBe(1);
  });
});

describe("setHeroMedia", () => {
  it("keeps one hero per stage", async () => {
    await setHeroMedia("m2");
    const db = await getDb();
    const heroes = await db
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(and(eq(schema.media.jobId, "job_1"), eq(schema.media.isHero, true)));
    expect(heroes.map((h) => h.id).sort()).toEqual(["m2", "m3"]);
  });
});

describe("approveMessage", () => {
  it("only acts on held messages and delegates to messaging", async () => {
    const db = await getDb();
    await db.insert(schema.messages).values([
      { id: "msg_held", tenantId: T, direction: "out", status: "held", body: "hi" },
      { id: "msg_sent", tenantId: T, direction: "out", status: "sent", body: "hi" },
    ]);
    expect(await approveMessage("msg_held")).toBe("sent");
    expect(messaging.approveHeldMessage).toHaveBeenCalledWith("msg_held", "agency");
    await expect(approveMessage("msg_sent")).rejects.toThrow(/already sent/);
  });
});
