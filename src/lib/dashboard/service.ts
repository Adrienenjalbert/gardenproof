/**
 * Dashboard mutations (framework-free so they can be unit-tested). actions.ts wraps these with auth,
 * input validation and cache revalidation. Every status change is written to the audit log as "agency".
 *
 * Long work (content generation, regeneration, video renders, publishing) is never run inside the request:
 * these functions ENQUEUE a durable task and return at once. The UI shows progress from the tasks table.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset, Message } from "@/db/schema";
import { CustomerError, attachCustomerToJob } from "@/lib/customers";
import { logEvent } from "@/lib/events";
import { approveHeldMessage, cancelHeldMessage } from "@/lib/messaging";
import { onAssetApproved } from "@/lib/pipeline";
import { enqueueTask, retryTask } from "@/lib/tasks";
import { getTenantBySlug } from "@/lib/tenants";
import { withdrawConsent } from "@/lib/testimonials";
import { validateAssetContent } from "./asset-fields";
import { approvalBlockers, bulkSkipReason } from "./logic";
import { KEPT_WITHHELD_TAG } from "./media-privacy";
import { recheckAssetOptional } from "./optional";

/** An error whose message is safe and useful to show the operator. */
export class DashboardError extends Error {}

const ACTOR = "agency";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function loadAsset(assetId: string): Promise<Asset> {
  const tenant = await getTenantBySlug();
  const db = await getDb();
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.tenantId, tenant.id)));
  if (!asset) throw new DashboardError("Asset not found.");
  return asset;
}

async function setAssetStatus(asset: Asset, status: Asset["status"], extra: Partial<Asset> = {}, data = {}, actor = ACTOR) {
  const db = await getDb();
  await db
    .update(schema.assets)
    .set({ ...extra, status, updatedAt: new Date() })
    .where(eq(schema.assets.id, asset.id));
  await logEvent({
    tenantId: asset.tenantId,
    type: `asset.${status}`,
    entity: "asset",
    entityId: asset.id,
    actor,
    data: { jobId: asset.jobId, from: asset.status, to: status, type: asset.type, ...data },
  });
}

/** Result of queueing background work: `deduped` means the same work was already queued or running. */
export type QueuedResult = { taskId: string; deduped: boolean };

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type ApproveResult = {
  assetId: string;
  status: Asset["status"];
  /** Set when approval succeeded but publishing couldn't even be queued (asset stays approved; retry later). */
  publishError: string | null;
};

/**
 * Approve an asset and queue publishing (the pipeline enqueues an `asset.publish` task and returns quickly).
 * Refuses when a consent or privacy check failed: those can never be overridden by hand.
 */
export async function approveAsset(assetId: string, actor = ACTOR): Promise<ApproveResult> {
  const asset = await loadAsset(assetId);
  if (asset.status === "published") throw new DashboardError("This asset is already published.");
  const blockers = approvalBlockers(asset.checks);
  if (blockers.length) {
    const kind = blockers.some((b) => b.id.startsWith("consent")) ? "consent" : "privacy";
    throw new DashboardError(`Can't approve: ${kind} check failed — ${blockers.map((b) => b.message).join("; ")}`);
  }
  if (asset.status !== "approved") await setAssetStatus(asset, "approved", {}, {}, actor);

  let publishError: string | null = null;
  try {
    await onAssetApproved(assetId);
  } catch (err) {
    publishError = errorMessage(err);
    await logEvent({
      tenantId: asset.tenantId,
      type: "asset.publish_failed",
      entity: "asset",
      entityId: asset.id,
      actor: ACTOR,
      data: { jobId: asset.jobId, error: publishError },
    });
  }
  const fresh = await loadAsset(assetId);
  return { assetId, status: fresh.status, publishError };
}

export async function rejectAsset(assetId: string, note: string, actor = ACTOR): Promise<void> {
  const asset = await loadAsset(assetId);
  if (asset.status === "published") throw new DashboardError("Published assets can't be rejected — edit them instead.");
  await setAssetStatus(asset, "rejected", { reviewNotes: note }, { note }, actor);
}

export type BulkSkip = { assetId: string; title: string; reason: string };

/**
 * Approve many assets at once. Only in-review assets whose automated checks ALL pass are approved; every other
 * asset is skipped with the reason (a failing which-rating or thin-input check is enough), never silently approved.
 */
export async function bulkApprove(assetIds: string[]): Promise<{ approved: ApproveResult[]; skipped: BulkSkip[] }> {
  const approved: ApproveResult[] = [];
  const skipped: BulkSkip[] = [];
  for (const id of assetIds) {
    let asset: Asset;
    try {
      asset = await loadAsset(id);
    } catch {
      skipped.push({ assetId: id, title: id, reason: "not found" });
      continue;
    }
    const reason = bulkSkipReason(asset);
    if (reason) {
      skipped.push({ assetId: id, title: asset.title, reason });
      continue;
    }
    approved.push(await approveAsset(id));
  }
  return { approved, skipped };
}

/**
 * Save edited content. Validates against the asset type's schema, uses the version for optimistic
 * concurrency, bumps it, and sends previously approved/rejected assets back to review.
 */
export async function saveAssetContent(assetId: string, content: unknown, expectedVersion: number): Promise<Asset> {
  const asset = await loadAsset(assetId);
  if (asset.version !== expectedVersion) {
    throw new DashboardError(
      `This asset changed since you opened it (now version ${asset.version}). Reload to see the latest.`,
    );
  }
  const v = validateAssetContent(asset.type, content);
  if (!v.ok) throw new DashboardError(`Content doesn't match the ${asset.type} format: ${v.errors.join("; ")}`);

  const nextStatus: Asset["status"] = asset.status === "draft" ? "draft" : "in_review";
  const db = await getDb();
  const [updated] = await db
    .update(schema.assets)
    .set({ content: v.content, version: sql`${schema.assets.version} + 1`, status: nextStatus, updatedAt: new Date() })
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.version, expectedVersion)))
    .returning();
  if (!updated) throw new DashboardError("Someone else saved this asset at the same time. Reload and try again.");
  await logEvent({
    tenantId: asset.tenantId,
    type: nextStatus !== asset.status ? `asset.${nextStatus}` : "asset.edited",
    entity: "asset",
    entityId: asset.id,
    actor: ACTOR,
    data: { jobId: asset.jobId, from: asset.status, to: nextStatus, version: updated.version, edited: true },
  });
  // Checks describe the previous text; refresh them when the content engine supports it.
  await recheckAssetOptional(assetId);
  return updated;
}

/** Queue a fresh draft of this asset, optionally steered by the operator's note. */
export async function regenerateAsset(assetId: string, instructions: string | undefined): Promise<QueuedResult> {
  const asset = await loadAsset(assetId);
  if (asset.status === "published") {
    throw new DashboardError("This asset is live. Edit it, or take it down before regenerating.");
  }
  const r = await enqueueTask({
    tenantId: asset.tenantId,
    type: "content.regenerate",
    payload: { assetId, instructions: instructions ?? null },
    dedupeKey: `content.regenerate:${assetId}`,
  });
  await logEvent({
    tenantId: asset.tenantId,
    type: "asset.regenerate_requested",
    entity: "asset",
    entityId: asset.id,
    actor: ACTOR,
    data: { jobId: asset.jobId, instructions: instructions ?? null, taskId: r.id, deduped: r.deduped },
  });
  return { taskId: r.id, deduped: r.deduped };
}

/** Queue a re-render of one video format. */
export async function rerenderVideo(assetId: string): Promise<QueuedResult> {
  const asset = await loadAsset(assetId);
  if (asset.type !== "video") throw new DashboardError("Only video assets can be re-rendered.");
  const r = await enqueueTask({
    tenantId: asset.tenantId,
    type: "video.render_asset",
    payload: { assetId },
    dedupeKey: `video.render_asset:${assetId}`,
  });
  await logEvent({
    tenantId: asset.tenantId,
    type: "asset.render_requested",
    entity: "asset",
    entityId: asset.id,
    actor: ACTOR,
    data: { jobId: asset.jobId, taskId: r.id, deduped: r.deduped },
  });
  return { taskId: r.id, deduped: r.deduped };
}

// ---------------------------------------------------------------------------
// Jobs & media
// ---------------------------------------------------------------------------

async function loadJob(jobId: string) {
  const tenant = await getTenantBySlug();
  const db = await getDb();
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.tenantId, tenant.id)));
  if (!job) throw new DashboardError("Job not found.");
  return job;
}

/** Queue content generation (then video renders) for a job. Idempotent: a second click joins the first run. */
export async function runContentGeneration(jobId: string): Promise<QueuedResult> {
  const job = await loadJob(jobId);
  if (job.status === "capturing") throw new DashboardError("The crew is still capturing this job.");
  const r = await enqueueTask({
    tenantId: job.tenantId,
    type: "pipeline.ready_for_content",
    payload: { jobId },
    dedupeKey: `pipeline.ready_for_content:${jobId}`,
  });
  await logEvent({
    tenantId: job.tenantId,
    type: "job.content_requested",
    entity: "job",
    entityId: jobId,
    actor: ACTOR,
    data: { status: job.status, taskId: r.id, deduped: r.deduped },
  });
  return { taskId: r.id, deduped: r.deduped };
}

/** Attach the homeowner to a crew-captured job (P0-4); the customers module prepares the review request. */
export async function attachHomeowner(
  jobId: string,
  input: { firstName: string; phone: string; postcode?: string; lastName?: string },
): Promise<void> {
  const job = await loadJob(jobId);
  if (job.customerId) throw new DashboardError("This job already has a homeowner.");
  try {
    await attachCustomerToJob(jobId, input, ACTOR);
  } catch (err) {
    // The customers module's validation messages are written for the operator.
    if (err instanceof CustomerError) throw new DashboardError(err.message);
    throw err;
  }
}

/** Make one photo the hero for its stage (one hero before, one hero after per job). */
export async function setHeroMedia(mediaId: string): Promise<void> {
  const tenant = await getTenantBySlug();
  const db = await getDb();
  const [m] = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, mediaId), eq(schema.media.tenantId, tenant.id)));
  if (!m) throw new DashboardError("Photo not found.");
  if (m.kind !== "image") throw new DashboardError("Only photos can be used as the hero image.");
  await db
    .update(schema.media)
    .set({ isHero: false })
    .where(and(eq(schema.media.jobId, m.jobId), eq(schema.media.stage, m.stage)));
  await db.update(schema.media).set({ isHero: true }).where(eq(schema.media.id, mediaId));
  await logEvent({
    tenantId: m.tenantId,
    type: "media.hero_set",
    entity: "job",
    entityId: m.jobId,
    actor: ACTOR,
    data: { mediaId, stage: m.stage },
  });
}

async function loadMedia(mediaId: string) {
  const tenant = await getTenantBySlug();
  const db = await getDb();
  const [m] = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, mediaId), eq(schema.media.tenantId, tenant.id)));
  if (!m) throw new DashboardError("Photo not found.");
  if (m.kind !== "image") throw new DashboardError("Only photos have a privacy check.");
  return m;
}

/**
 * The operator looked at the photo and confirmed there are no faces, number plates or house numbers (P0-2).
 * `publishableImageKey` then allows its EXIF-stripped copy. Logged with the flag that was overridden.
 */
export async function clearMediaPrivacy(mediaId: string): Promise<void> {
  const m = await loadMedia(mediaId);
  const db = await getDb();
  await db
    .update(schema.media)
    .set({ privacyClearedAt: new Date(), tags: (m.tags ?? []).filter((t) => t !== KEPT_WITHHELD_TAG) })
    .where(eq(schema.media.id, mediaId));
  await logEvent({
    tenantId: m.tenantId,
    type: "media.privacy_cleared",
    entity: "media",
    entityId: mediaId,
    actor: ACTOR,
    data: { jobId: m.jobId, qualityNotes: m.qualityNotes, publicKey: m.publicKey },
  });
}

/** Keep a flagged photo out of public use (and undo an earlier clearance). Removes it from "Needs you". */
export async function keepMediaWithheld(mediaId: string): Promise<void> {
  const m = await loadMedia(mediaId);
  const db = await getDb();
  const tags = [...new Set([...(m.tags ?? []), KEPT_WITHHELD_TAG])];
  await db.update(schema.media).set({ privacyClearedAt: null, tags }).where(eq(schema.media.id, mediaId));
  await logEvent({
    tenantId: m.tenantId,
    type: "media.privacy_withheld",
    entity: "media",
    entityId: mediaId,
    actor: ACTOR,
    data: { jobId: m.jobId, qualityNotes: m.qualityNotes, wasCleared: m.privacyClearedAt !== null },
  });
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/** Homeowner asked to withdraw (P1-8). The testimonials module records it and queues take-downs. */
export async function withdrawTestimonialConsent(testimonialId: string, reason: string | undefined): Promise<void> {
  const tenant = await getTenantBySlug();
  const db = await getDb();
  const [t] = await db
    .select()
    .from(schema.testimonials)
    .where(and(eq(schema.testimonials.id, testimonialId), eq(schema.testimonials.tenantId, tenant.id)));
  if (!t) throw new DashboardError("Testimonial not found.");
  if (t.withdrawnAt) throw new DashboardError("Consent was already withdrawn.");
  await withdrawConsent(testimonialId, ACTOR, reason);
}

// ---------------------------------------------------------------------------
// Background tasks
// ---------------------------------------------------------------------------

/** Retry a failed background task for this tenant with a fresh attempt budget. */
export async function retryFailedTask(taskId: string): Promise<void> {
  const tenant = await getTenantBySlug();
  const db = await getDb();
  const [t] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.tenantId, tenant.id)));
  if (!t) throw new DashboardError("Task not found.");
  if (t.status !== "failed") throw new DashboardError(`This task is ${t.status}, not failed — nothing to retry.`);
  const row = await retryTask(taskId);
  if (!row || row.status === "failed") throw new DashboardError("Couldn't re-queue the task. Try again.");
  await logEvent({
    tenantId: tenant.id,
    type: "task.retried",
    entity: "task",
    entityId: taskId,
    actor: ACTOR,
    data: { type: t.type, payload: t.payload, lastError: t.lastError },
  });
}

// ---------------------------------------------------------------------------
// Safe-mode outbox
// ---------------------------------------------------------------------------

async function loadHeldMessage(id: string) {
  const tenant = await getTenantBySlug();
  const db = await getDb();
  const [msg] = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.id, id), eq(schema.messages.tenantId, tenant.id)));
  if (!msg) throw new DashboardError("Message not found.");
  if (msg.status !== "held") throw new DashboardError(`This message is already ${msg.status}.`);
  return msg;
}

/** Approve & send a held customer message. Messaging re-checks opt-out and logs the event itself. */
export async function approveMessage(id: string): Promise<Message["status"]> {
  await loadHeldMessage(id);
  const result = await approveHeldMessage(id, ACTOR);
  return result.status;
}

export async function cancelMessage(id: string): Promise<void> {
  await loadHeldMessage(id);
  await cancelHeldMessage(id, ACTOR);
}
