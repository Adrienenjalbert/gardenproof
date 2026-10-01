/**
 * Task catalogue: every background job type and the shape of its payload (validated on enqueue and on run).
 * Adding a type = add its payload schema here and its handler in ./handlers.ts (the type system enforces both).
 */
import { z } from "zod";

const jobPayload = z.object({ jobId: z.string().min(1) });
const assetPayload = z.object({ assetId: z.string().min(1) });

export const TASK_PAYLOADS = {
  /** Crew tapped Done (and gave / skipped the homeowner contact): enrich, request the testimonial. */
  "pipeline.job_completed": jobPayload,
  /** Testimonial in, refused or timed out: draft content, then queue the video renders. */
  "pipeline.ready_for_content": jobPayload,
  "video.render_job": jobPayload,
  "video.render_asset": assetPayload,
  "content.regenerate": assetPayload.extend({ instructions: z.string().max(2000).nullish() }),
  "asset.publish": assetPayload,
  "asset.unpublish": assetPayload.extend({ reason: z.string().min(1).max(500) }),
  /** Hourly sweep: homeowner links unanswered for 48h move their job on. Reschedules itself. */
  "testimonials.expire": z.object({}),
  /** Every minute: send CRM messages that are due (respecting trust tiers). Reschedules itself. */
  "crm.dispatch_due": z.object({}),
  /** Hourly: nudge people with unfinished smart forms (24h, 72h, then stop). Reschedules itself. */
  "forms.remind": z.object({}),
  /** Build a BusinessProfile from a website URL (Firecrawl + web search). */
  "intel.onboard": z.object({ runId: z.string().min(1) }),
} as const;

export type TaskType = keyof typeof TASK_PAYLOADS;
export type TaskPayload<T extends TaskType> = z.infer<(typeof TASK_PAYLOADS)[T]>;
export const TASK_TYPES = Object.keys(TASK_PAYLOADS) as TaskType[];

export type TaskStatus = "queued" | "running" | "done" | "failed";

/** Hard ceiling per attempt. Renders get longest; all stay under the 30-minute stale-lock threshold. */
export const TASK_TIMEOUT_MS: Record<TaskType, number> = {
  "pipeline.job_completed": 10 * 60_000,
  "pipeline.ready_for_content": 15 * 60_000,
  "video.render_job": 25 * 60_000,
  "video.render_asset": 10 * 60_000,
  "content.regenerate": 10 * 60_000,
  "asset.publish": 5 * 60_000,
  "asset.unpublish": 5 * 60_000,
  "testimonials.expire": 5 * 60_000,
  "crm.dispatch_due": 2 * 60_000,
  "forms.remind": 5 * 60_000,
  "intel.onboard": 15 * 60_000,
};

/** Thrown by a handler when retrying cannot help (missing row, invalid payload, blocked by checks). */
export class PermanentTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentTaskError";
  }
}

/** What a handler may ask of the worker after success. */
export type HandlerResult = void | { rescheduleAt: Date };
