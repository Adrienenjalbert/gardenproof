/**
 * The production handler for every task type. Each one is idempotent: tasks can run more than once
 * (retries, recovered locks), so handlers re-read state and skip work that is already done.
 */
import { jobIdOfAsset, onJobCompleted, onReadyForContent, retractIfConsentWithdrawn } from "@/lib/pipeline";
import { refreshSeoForPortfolioPage, regenerateAsset } from "@/lib/content";
import { PublishError, publishAsset, unpublishAsset } from "@/lib/publish";
import { expireStaleTestimonials } from "@/lib/testimonials";
import { renderVideoAsset, renderVideosForJob } from "@/lib/video";
import { dispatchDueMessages } from "@/lib/crm-engine";
import { sendFormReminders } from "@/lib/forms";
import { runOnboarding } from "@/lib/intel";
import { PermanentTaskError } from "./types";
import type { TaskHandlers } from "./worker";

export const EXPIRY_SWEEP_EVERY_MS = 60 * 60_000;
export const CRM_DISPATCH_EVERY_MS = 60_000;
export const FORMS_REMIND_EVERY_MS = 60 * 60_000;

/** Publishing refusals (not approved, held by checks) won't fix themselves on retry. */
async function permanentOnPublishError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof PublishError) throw new PermanentTaskError(err.message);
    throw err;
  }
}

/** Run slow work for a job, then retract whatever it produced if consent was withdrawn meanwhile. */
async function thenHonourWithdrawal(jobId: string | null, run: () => Promise<unknown>): Promise<void> {
  await run();
  await retractIfConsentWithdrawn(jobId);
}

export const TASK_HANDLERS: TaskHandlers = {
  "pipeline.job_completed": ({ jobId }) => onJobCompleted(jobId),
  "pipeline.ready_for_content": ({ jobId }) => onReadyForContent(jobId),
  "video.render_job": ({ jobId }) => thenHonourWithdrawal(jobId, () => renderVideosForJob(jobId)),
  "video.render_asset": async ({ assetId }) => thenHonourWithdrawal(await jobIdOfAsset(assetId), () => renderVideoAsset(assetId)),
  "content.regenerate": async ({ assetId, instructions }) =>
    thenHonourWithdrawal(await jobIdOfAsset(assetId), () => regenerateAsset(assetId, instructions ?? undefined)),
  "asset.publish": async ({ assetId }) => {
    // Never publish for a homeowner who has withdrawn consent (the approval may predate the withdrawal).
    if (await retractIfConsentWithdrawn(await jobIdOfAsset(assetId))) throw new PermanentTaskError("Consent withdrawn: not published");
    const result = await permanentOnPublishError(() => publishAsset(assetId));
    // A newly published portfolio page may complete a (service, area) cluster → create/refresh its area article.
    try {
      await refreshSeoForPortfolioPage(assetId);
    } catch (err) {
      console.error("[tasks] SEO refresh after publish failed", assetId, err);
    }
    return result;
  },
  "asset.unpublish": ({ assetId, reason }) => permanentOnPublishError(() => unpublishAsset(assetId, reason)),
  "testimonials.expire": async () => {
    await expireStaleTestimonials(new Date());
    return { rescheduleAt: new Date(Date.now() + EXPIRY_SWEEP_EVERY_MS) };
  },
  "crm.dispatch_due": async () => {
    await dispatchDueMessages(new Date());
    return { rescheduleAt: new Date(Date.now() + CRM_DISPATCH_EVERY_MS) };
  },
  "forms.remind": async () => {
    await sendFormReminders(new Date());
    return { rescheduleAt: new Date(Date.now() + FORMS_REMIND_EVERY_MS) };
  },
  "intel.onboard": ({ runId }) => runOnboarding(runId),
};
