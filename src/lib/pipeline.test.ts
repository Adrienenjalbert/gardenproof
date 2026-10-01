import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { T, seedJob, seedTenant } from "@/lib/bot/test-fixtures";

const mocks = vi.hoisted(() => ({
  enrichJob: vi.fn(async () => {}),
  generateContentForJob: vi.fn(async (jobId: string) => ({ jobId, skipped: null as null | "no_consent" | "no_public_media", assets: [] })),
  regenerateAsset: vi.fn(async () => ({})),
  renderVideosForJob: vi.fn(async () => ({ assetIds: [] as string[], failed: [] as { title: string; error: string }[], skipped: null as string | null })),
  renderVideoAsset: vi.fn(async () => "ast_x"),
  publishAsset: vi.fn(async () => ({})),
  unpublishAsset: vi.fn(async () => ({})),
}));
vi.mock("@/lib/content", () => ({ enrichJob: mocks.enrichJob, generateContentForJob: mocks.generateContentForJob, regenerateAsset: mocks.regenerateAsset }));
vi.mock("@/lib/video", () => ({ renderVideosForJob: mocks.renderVideosForJob, renderVideoAsset: mocks.renderVideoAsset }));
vi.mock("@/lib/publish", () => {
  class PublishError extends Error {}
  return { PublishError, publishAsset: mocks.publishAsset, unpublishAsset: mocks.unpublishAsset };
});

import { markJobCompleted, homeownerStepDone, onAssetApproved, onJobCompleted, onReadyForContent, requestContent } from "./pipeline";
import { HOMEOWNER_GRACE_MS } from "./tasks";
import { TASK_HANDLERS } from "./tasks/handlers";
import { drainTasks } from "./tasks/worker";

beforeAll(() => seedTenant(), 120_000);
beforeEach(async () => {
  vi.clearAllMocks();
  await (await getDb()).delete(schema.tasks);
});

async function tasksOf(type: string, id: string, key: "jobId" | "assetId" = "jobId") {
  return (await getDb()).select().from(schema.tasks).where(and(eq(schema.tasks.type, type), sql`${schema.tasks.payload}->>${key} = ${id}`));
}
async function jobRow(id: string) {
  return (await (await getDb()).select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0];
}
async function addAsset(jobId: string, status: "in_review" | "published") {
  const [a] = await (await getDb())
    .insert(schema.assets)
    .values({ id: `ast_${Math.random().toString(36).slice(2, 10)}`, tenantId: T, jobId, type: "gbp_post", status, title: "x", content: {} })
    .returning();
  return a;
}

describe("triggers only enqueue", () => {
  it("markJobCompleted captures the job now and queues the pipeline after the homeowner grace period", async () => {
    const j = await seedJob({ status: "capturing" });
    const now = new Date();
    await markJobCompleted(j.id, { actor: "crw_marco", now });
    expect(await jobRow(j.id)).toMatchObject({ status: "captured" });
    const [task] = await tasksOf("pipeline.job_completed", j.id);
    expect(task.runAt.getTime()).toBe(now.getTime() + HOMEOWNER_GRACE_MS);
    await homeownerStepDone(j.id);
    const after = await tasksOf("pipeline.job_completed", j.id);
    expect(after).toHaveLength(1);
    expect(after[0].runAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(mocks.enrichJob).not.toHaveBeenCalled();
  });

  it("onAssetApproved queues one publish per asset, however many clicks", async () => {
    const j = await seedJob();
    const a = await addAsset(j.id, "in_review");
    const [x, y] = await Promise.all([onAssetApproved(a.id), onAssetApproved(a.id)]);
    expect(x.id).toBe(y.id);
    expect(await tasksOf("asset.publish", a.id, "assetId")).toHaveLength(1);
  });

  it("requestContent de-duplicates the content run for a job", async () => {
    const j = await seedJob();
    await requestContent(j.id);
    expect((await requestContent(j.id)).deduped).toBe(true);
  });
});

describe("handlers", () => {
  it("job_completed enriches and asks the homeowner; no customer -> straight to content", async () => {
    const withCustomer = await seedJob({ status: "captured" });
    await onJobCompleted(withCustomer.id);
    expect(mocks.enrichJob).toHaveBeenCalledWith(withCustomer.id);
    expect(await jobRow(withCustomer.id)).toMatchObject({ status: "awaiting_testimonial" });
    expect(await tasksOf("pipeline.ready_for_content", withCustomer.id)).toHaveLength(0);

    const crewOnly = await seedJob({ status: "captured", customerId: null });
    await onJobCompleted(crewOnly.id);
    expect(await tasksOf("pipeline.ready_for_content", crewOnly.id)).toHaveLength(1);
  });

  it("job_completed re-run never re-asks the homeowner", async () => {
    const j = await seedJob({ status: "in_review" });
    await onJobCompleted(j.id);
    expect(await (await getDb()).select().from(schema.testimonials).where(eq(schema.testimonials.jobId, j.id))).toHaveLength(0);
  });

  it("ready_for_content drafts content then queues the renders, without downgrading a published job", async () => {
    const j = await seedJob({ status: "awaiting_testimonial" });
    await onReadyForContent(j.id);
    expect(mocks.generateContentForJob).toHaveBeenCalledWith(j.id);
    expect(await tasksOf("video.render_job", j.id)).toHaveLength(1);

    const live = await seedJob({ status: "published" });
    await onReadyForContent(live.id);
    expect((await jobRow(live.id)).status).toBe("published");
  });

  it("ready_for_content with photo consent refused retracts drafts and queues takedowns", async () => {
    const j = await seedJob({ status: "awaiting_testimonial" });
    const draft = await addAsset(j.id, "in_review");
    const live = await addAsset(j.id, "published");
    mocks.generateContentForJob.mockResolvedValueOnce({ jobId: j.id, skipped: "no_consent", assets: [] });
    await onReadyForContent(j.id);
    const [d] = await (await getDb()).select().from(schema.assets).where(eq(schema.assets.id, draft.id));
    expect(d.status).toBe("rejected");
    expect(await tasksOf("asset.unpublish", live.id, "assetId")).toHaveLength(1);
    expect(await tasksOf("video.render_job", j.id)).toHaveLength(0);
  });

  it("honours a withdrawal that happened while a render ran, and never publishes after one", async () => {
    const j = await seedJob({ status: "in_review" });
    const [t] = await (await getDb())
      .insert(schema.testimonials)
      .values({ id: `tst_${j.id}`, tenantId: T, jobId: j.id, token: `tok_${j.id}_xxxxxxxxxxxx`, status: "responded", consentPhotos: true })
      .returning();
    let video = "";
    mocks.renderVideosForJob.mockImplementationOnce(async () => {
      video = (await addAsset(j.id, "in_review")).id; // render finishes after…
      await (await getDb()).update(schema.testimonials).set({ withdrawnAt: new Date() }).where(eq(schema.testimonials.id, t.id)); // …consent was withdrawn
      return { assetIds: [video], failed: [], skipped: null };
    });
    await (await getDb()).insert(schema.tasks).values({ id: `tsk_r_${j.id}`, tenantId: T, type: "video.render_job", payload: { jobId: j.id } });
    await drainTasks({ handlers: TASK_HANDLERS });
    const [v] = await (await getDb()).select().from(schema.assets).where(eq(schema.assets.id, video));
    expect(v.status).toBe("rejected");

    const approved = await addAsset(j.id, "in_review");
    await onAssetApproved(approved.id);
    await drainTasks({ handlers: TASK_HANDLERS });
    expect(mocks.publishAsset).not.toHaveBeenCalled();
    expect((await tasksOf("asset.publish", approved.id, "assetId"))[0]).toMatchObject({ status: "failed", lastError: "Consent withdrawn: not published" });
  });

  it("missing jobs fail permanently (no pointless retries)", async () => {
    await requestContent((await seedJob()).id);
    await (await getDb()).insert(schema.tasks).values({ id: "tsk_ghost", tenantId: T, type: "pipeline.ready_for_content", payload: { jobId: "job_ghost" } });
    await drainTasks({ handlers: TASK_HANDLERS });
    const [ghost] = await (await getDb()).select().from(schema.tasks).where(eq(schema.tasks.id, "tsk_ghost"));
    expect(ghost).toMatchObject({ status: "failed", attempts: 1 });
    expect(ghost.lastError).toMatch(/not found/);
  });

  it("publish refusals are permanent; unpublish and renders route to their modules", async () => {
    const { PublishError } = await import("@/lib/publish");
    mocks.publishAsset.mockRejectedValueOnce(new PublishError("held by failing checks (privacy)"));
    const j = await seedJob();
    const a = await addAsset(j.id, "in_review");
    await onAssetApproved(a.id);
    await (await getDb()).insert(schema.tasks).values([
      { id: "tsk_un", tenantId: T, type: "asset.unpublish", payload: { assetId: a.id, reason: "withdrawn" } },
      { id: "tsk_ra", tenantId: T, type: "video.render_asset", payload: { assetId: a.id } },
      { id: "tsk_rg", tenantId: T, type: "content.regenerate", payload: { assetId: a.id, instructions: "shorter" } },
    ]);
    await drainTasks({ handlers: TASK_HANDLERS });
    const [pub] = await tasksOf("asset.publish", a.id, "assetId");
    expect(pub).toMatchObject({ status: "failed", attempts: 1 });
    expect(mocks.unpublishAsset).toHaveBeenCalledWith(a.id, "withdrawn");
    expect(mocks.renderVideoAsset).toHaveBeenCalledWith(a.id);
    expect(mocks.regenerateAsset).toHaveBeenCalledWith(a.id, "shorter");
  });
});
