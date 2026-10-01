/**
 * Phase 1 pipeline — how a job flows from WhatsApp capture to published assets.
 * Nothing slow runs inside a request: triggers only ENQUEUE durable tasks (src/lib/tasks); the worker runs them.
 *
 *   crew taps Done ─► markJobCompleted ─► [task pipeline.job_completed] (after the homeowner-contact step
 *                                          or a 15-minute grace) ─► enrichJob + requestTestimonial
 *   homeowner submits / declines / 48h expiry ─► [task pipeline.ready_for_content]
 *                                          ─► generateContentForJob ─► [task video.render_job]
 *   agency approves asset ─► onAssetApproved ─► [task asset.publish]
 *   consent withdrawn ─► [task asset.unpublish] per published asset
 *
 * Every handler is idempotent and safe to re-run (tasks retry with backoff).
 */
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { logEvent } from "./events";
import { enrichJob, generateContentForJob } from "./content";
import {
  HOMEOWNER_GRACE_MS,
  enqueueJobCompleted,
  enqueuePublish,
  enqueueReadyForContent,
  enqueueRegenerate,
  enqueueRenderAsset,
  enqueueRenderJob,
  enqueueUnpublish,
} from "./tasks/enqueue";
import { PermanentTaskError } from "./tasks/types";
import { requestTestimonial, retractJobAssets } from "./testimonials";

type Queued = { id: string; deduped: boolean };

async function loadJob(jobId: string) {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) throw new PermanentTaskError(`Job ${jobId} not found`);
  return job;
}

async function loadAsset(assetId: string) {
  const db = await getDb();
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId));
  if (!asset) throw new PermanentTaskError(`Asset ${assetId} not found`);
  return asset;
}

// ---------------------------------------------------------------------------
// Triggers (fast: called from requests / the bot)
// ---------------------------------------------------------------------------

/**
 * Crew tapped Done: the job is captured now; the heavy follow-up is queued after a grace period so the
 * crew can still share the homeowner's contact. `homeownerStepDone` pulls the task forward.
 */
export async function markJobCompleted(jobId: string, opts: { actor?: string; now?: Date } = {}): Promise<Queued> {
  const now = opts.now ?? new Date();
  const db = await getDb();
  const job = await loadJob(jobId);
  if (job.status === "capturing") {
    await db.update(schema.jobs).set({ status: "captured", completedAt: job.completedAt ?? now, updatedAt: now }).where(eq(schema.jobs.id, jobId));
    await logEvent({ tenantId: job.tenantId, type: "job.completed", entity: "job", entityId: jobId, actor: opts.actor });
  }
  // The crew's Done moves a booked / on-site job to Finished, which plans the review request and aftercare.
  await (await import("./crm-engine/capture")).advanceFromCapture(jobId, "crew_done", { actor: opts.actor, now });
  return enqueueJobCompleted(job.tenantId, jobId, { runAt: new Date(now.getTime() + HOMEOWNER_GRACE_MS) });
}

/** The crew answered the homeowner question (contact shared or skipped): run the job-completed task now. */
export async function homeownerStepDone(jobId: string): Promise<Queued> {
  const job = await loadJob(jobId);
  return enqueueJobCompleted(job.tenantId, jobId);
}

/** Dashboard "Generate content" (or any re-run): queue content drafting for the job. */
export async function requestContent(jobId: string): Promise<Queued> {
  const job = await loadJob(jobId);
  return enqueueReadyForContent(job.tenantId, jobId);
}

/** Agency approved an asset: queue its publication (idempotent per asset). */
export async function onAssetApproved(assetId: string): Promise<Queued> {
  const asset = await loadAsset(assetId);
  return enqueuePublish(asset.tenantId, assetId);
}

export async function requestUnpublish(assetId: string, reason: string): Promise<Queued> {
  const asset = await loadAsset(assetId);
  return enqueueUnpublish(asset.tenantId, assetId, reason);
}

export async function requestRegenerate(assetId: string, instructions?: string | null): Promise<Queued> {
  const asset = await loadAsset(assetId);
  return enqueueRegenerate(asset.tenantId, assetId, instructions);
}

/** Re-render one video asset (e.g. after its hook was edited). */
export async function requestVideoRender(assetId: string): Promise<Queued> {
  const asset = await loadAsset(assetId);
  return enqueueRenderAsset(asset.tenantId, assetId);
}

/** Render every planned video for a job. */
export async function requestJobVideos(jobId: string): Promise<Queued> {
  const job = await loadJob(jobId);
  return enqueueRenderJob(job.tenantId, jobId);
}

// ---------------------------------------------------------------------------
// Task handlers (slow: run by the worker)
// ---------------------------------------------------------------------------

/** Task "pipeline.job_completed": enrich the photos/voice notes and ask the homeowner (if we know them). */
export async function onJobCompleted(jobId: string): Promise<void> {
  const db = await getDb();
  let job = await loadJob(jobId);
  if (job.status === "capturing") {
    await db.update(schema.jobs).set({ status: "captured", completedAt: job.completedAt ?? new Date(), updatedAt: new Date() }).where(eq(schema.jobs.id, jobId));
    job = await loadJob(jobId);
  }
  await enrichJob(jobId);
  // Only a freshly captured job asks the homeowner; a re-run must never re-message them.
  if (job.status !== "captured") return;
  const requested = await requestTestimonial(jobId);
  if (!requested) await enqueueReadyForContent(job.tenantId, jobId);
}

/** Task "pipeline.ready_for_content": draft the text assets, then queue the video renders. */
export async function onReadyForContent(jobId: string): Promise<void> {
  const db = await getDb();
  const job = await loadJob(jobId);
  // Never downgrade a published job: a re-run adds new versions for review alongside what is live.
  if (job.status !== "published") {
    await db.update(schema.jobs).set({ status: "ready_for_content", updatedAt: new Date() }).where(eq(schema.jobs.id, jobId));
  }
  const summary = await generateContentForJob(jobId);
  if (summary.skipped === "no_consent") {
    // Photos refused (possibly after drafts were made): nothing of this job may stay in review or online.
    await retractJobAssets(jobId, "Homeowner did not consent to photos", "system");
    return;
  }
  if (summary.skipped) return;
  await enqueueRenderJob(job.tenantId, jobId);
}

/**
 * Consent can be withdrawn while a slow task (render, regeneration) is running: anything that task created
 * afterwards must be retracted too. Returns true when the job's homeowner has withdrawn consent.
 */
export async function retractIfConsentWithdrawn(jobId: string | null): Promise<boolean> {
  if (!jobId) return false;
  const db = await getDb();
  const [t] = await db
    .select({ withdrawnAt: schema.testimonials.withdrawnAt })
    .from(schema.testimonials)
    .where(eq(schema.testimonials.jobId, jobId))
    .orderBy(desc(schema.testimonials.createdAt))
    .limit(1);
  if (!t?.withdrawnAt) return false;
  await retractJobAssets(jobId, "Homeowner withdrew permission", "system");
  return true;
}

/** Job id of an asset (null for multi-job assets such as area articles). */
export async function jobIdOfAsset(assetId: string): Promise<string | null> {
  return (await loadAsset(assetId)).jobId;
}
