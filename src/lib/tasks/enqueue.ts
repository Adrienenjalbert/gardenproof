/**
 * Typed shortcuts for queueing pipeline work, with the dedupe keys that make double clicks and
 * overlapping triggers harmless. Request handlers call these and return at once; the worker does the work.
 * Kept free of pipeline imports so testimonials/bot/dashboard can use it without import cycles.
 */
import { enqueueTask, type Executor } from "./queue";

/** How long the crew has to share the homeowner's contact after Done before the pipeline moves on anyway. */
export const HOMEOWNER_GRACE_MS = 15 * 60_000;

export const dedupeKeys = {
  jobCompleted: (jobId: string) => `pipeline.job_completed:${jobId}`,
  readyForContent: (jobId: string) => `pipeline.ready_for_content:${jobId}`,
  renderJob: (jobId: string) => `video.render_job:${jobId}`,
  renderAsset: (assetId: string) => `video.render_asset:${assetId}`,
  regenerate: (assetId: string) => `content.regenerate:${assetId}`,
  publish: (assetId: string) => `asset.publish:${assetId}`,
  unpublish: (assetId: string) => `asset.unpublish:${assetId}`,
  expire: () => "testimonials.expire",
};

type Opts = { runAt?: Date; executor?: Executor };

export const enqueueJobCompleted = (tenantId: string, jobId: string, o: Opts = {}) =>
  enqueueTask({ tenantId, type: "pipeline.job_completed", payload: { jobId }, dedupeKey: dedupeKeys.jobCompleted(jobId), runAt: o.runAt }, o.executor);

export const enqueueReadyForContent = (tenantId: string, jobId: string, o: Opts = {}) =>
  enqueueTask({ tenantId, type: "pipeline.ready_for_content", payload: { jobId }, dedupeKey: dedupeKeys.readyForContent(jobId), runAt: o.runAt }, o.executor);

export const enqueueRenderJob = (tenantId: string, jobId: string, o: Opts = {}) =>
  enqueueTask({ tenantId, type: "video.render_job", payload: { jobId }, dedupeKey: dedupeKeys.renderJob(jobId), runAt: o.runAt, maxAttempts: 2 }, o.executor);

export const enqueueRenderAsset = (tenantId: string, assetId: string, o: Opts = {}) =>
  enqueueTask({ tenantId, type: "video.render_asset", payload: { assetId }, dedupeKey: dedupeKeys.renderAsset(assetId), runAt: o.runAt, maxAttempts: 2 }, o.executor);

export const enqueueRegenerate = (tenantId: string, assetId: string, instructions?: string | null, o: Opts = {}) =>
  enqueueTask({ tenantId, type: "content.regenerate", payload: { assetId, instructions: instructions ?? null }, dedupeKey: dedupeKeys.regenerate(assetId), runAt: o.runAt }, o.executor);

export const enqueuePublish = (tenantId: string, assetId: string, o: Opts = {}) =>
  enqueueTask({ tenantId, type: "asset.publish", payload: { assetId }, dedupeKey: dedupeKeys.publish(assetId), runAt: o.runAt }, o.executor);

export const enqueueUnpublish = (tenantId: string, assetId: string, reason: string, o: Opts = {}) =>
  enqueueTask({ tenantId, type: "asset.unpublish", payload: { assetId, reason }, dedupeKey: dedupeKeys.unpublish(assetId), runAt: o.runAt, maxAttempts: 5 }, o.executor);

/** System-wide expiry sweep; one queued at a time. Enqueueing again (cron) pulls the next run forward. */
export const enqueueExpirySweep = (o: Opts = {}) =>
  enqueueTask({ tenantId: null, type: "testimonials.expire", payload: {}, dedupeKey: dedupeKeys.expire(), runAt: o.runAt }, o.executor);

/** System-wide sweeps for CRM message dispatch (every minute) and form reminders (hourly); one queued at a time. */
export const enqueueCrmDispatchSweep = (o: Opts = {}) =>
  enqueueTask({ tenantId: null, type: "crm.dispatch_due", payload: {}, dedupeKey: "crm.dispatch_due", runAt: o.runAt }, o.executor);
export const enqueueFormsReminderSweep = (o: Opts = {}) =>
  enqueueTask({ tenantId: null, type: "forms.remind", payload: {}, dedupeKey: "forms.remind", runAt: o.runAt }, o.executor);
