"use server";
/**
 * Server Actions for the dashboard. Each one: re-checks the session (actions are public POST endpoints),
 * validates input with zod, calls the service layer, revalidates affected pages, and returns a result
 * object the UI can show — errors are returned, never thrown to the client.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "./action-result";
import {
  DashboardError,
  approveAsset,
  approveMessage,
  attachHomeowner,
  bulkApprove,
  cancelMessage,
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
import { NotAvailableError } from "./optional";
import { UnauthorisedError, requireAgency } from "./session";

const id = z.string().trim().min(1).max(100);
const note = z.string().trim().max(2000);

/** Refresh every dashboard page (layout counts + lists) after a mutation. */
function revalidateDashboard() {
  revalidatePath("/", "layout");
}

async function run<T>(schema: z.ZodType<T>, input: unknown, fn: (v: T) => Promise<string>): Promise<ActionResult> {
  try {
    await requireAgency();
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    }
    const message = await fn(parsed.data);
    revalidateDashboard();
    return { ok: true, message };
  } catch (err) {
    if (err instanceof DashboardError || err instanceof NotAvailableError || err instanceof UnauthorisedError) {
      revalidateDashboard();
      return { ok: false, error: err.message };
    }
    console.error("[dashboard action]", err);
    revalidateDashboard();
    return { ok: false, error: `Something went wrong: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function approveAssetAction(assetId: string): Promise<ActionResult> {
  return run(id, assetId, async (v) => {
    const r = await approveAsset(v);
    if (r.publishError) throw new DashboardError(`Approved, but publishing couldn't be queued: ${r.publishError}`);
    return r.status === "published" ? "Approved and published." : "Approved — publishing in the background.";
  });
}

export async function rejectAssetAction(input: { assetId: string; note: string }): Promise<ActionResult> {
  return run(
    z.object({ assetId: id, note: note.min(1, "Add a short note so the next draft can fix it.") }),
    input,
    async (v) => {
      await rejectAsset(v.assetId, v.note);
      return "Rejected with note.";
    },
  );
}

export async function regenerateAssetAction(input: { assetId: string; note?: string }): Promise<ActionResult> {
  return run(z.object({ assetId: id, note: note.optional() }), input, async (v) => {
    const r = await regenerateAsset(v.assetId, v.note || undefined);
    return r.deduped ? "Already regenerating — the new draft will appear here." : "Regenerating — the new draft will appear here.";
  });
}

export async function bulkApproveAction(assetIds: string[]): Promise<ActionResult> {
  return run(z.array(id).min(1, "Nothing selected.").max(200), assetIds, async (v) => {
    const r = await bulkApprove(v);
    const failed = r.approved.filter((a) => a.publishError).length;
    const head = [
      `${r.approved.length} approved — publishing in the background`,
      failed ? `${failed} couldn't be queued for publishing` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (!r.skipped.length) return `${head}.`;
    const why = r.skipped.map((s) => `“${s.title}”: ${s.reason}`).join(" · ");
    return `${head}. Skipped ${r.skipped.length}: ${why}`;
  });
}

export async function saveAssetContentAction(input: {
  assetId: string;
  version: number;
  contentJson: string;
}): Promise<ActionResult> {
  return run(
    z.object({ assetId: id, version: z.number().int().positive(), contentJson: z.string().max(500_000) }),
    input,
    async (v) => {
      let content: unknown;
      try {
        content = JSON.parse(v.contentJson);
      } catch {
        throw new DashboardError("That isn't valid JSON — check for a missing comma or quote.");
      }
      const saved = await saveAssetContent(v.assetId, content, v.version);
      return `Saved as version ${saved.version}.`;
    },
  );
}

export async function setHeroMediaAction(mediaId: string): Promise<ActionResult> {
  return run(id, mediaId, async (v) => {
    await setHeroMedia(v);
    return "Hero photo updated.";
  });
}

export async function runContentGenerationAction(jobId: string): Promise<ActionResult> {
  return run(id, jobId, async (v) => {
    const r = await runContentGeneration(v);
    return r.deduped
      ? "Content generation is already running for this job."
      : "Content generation started — drafts appear in Assets as they're ready.";
  });
}

export async function rerenderVideoAction(assetId: string): Promise<ActionResult> {
  return run(id, assetId, async (v) => {
    const r = await rerenderVideo(v);
    return r.deduped ? "This video is already rendering." : "Re-render queued — it usually takes a minute or two.";
  });
}

export async function retryTaskAction(taskId: string): Promise<ActionResult> {
  return run(id, taskId, async (v) => {
    await retryFailedTask(v);
    return "Queued again.";
  });
}

/** UK mobile or any E.164 number; the customers module normalises it. */
const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d\s().-]{10,20}$/, "Enter a mobile number, e.g. 07700 900123.");
const postcode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/, "Enter a UK postcode, e.g. SW19 4AB (or leave it blank).");

const HomeownerInput = z.object({
  jobId: id,
  firstName: z.string().trim().min(1, "Enter the homeowner's first name.").max(60),
  phone,
  postcode: z.union([postcode, z.literal("")]).optional(),
});

export async function attachHomeownerAction(input: {
  jobId: string;
  firstName: string;
  phone: string;
  postcode?: string;
}): Promise<ActionResult> {
  return run(HomeownerInput, input, async (v) => {
    await attachHomeowner(v.jobId, { firstName: v.firstName, phone: v.phone, postcode: v.postcode || undefined });
    return `${v.firstName} added. A review request is being prepared — approve it in Messages to send it.`;
  });
}

export async function clearMediaPrivacyAction(mediaId: string): Promise<ActionResult> {
  return run(id, mediaId, async (v) => {
    await clearMediaPrivacy(v);
    return "Marked safe to publish. Re-run content or re-render videos to use it.";
  });
}

export async function keepMediaWithheldAction(mediaId: string): Promise<ActionResult> {
  return run(id, mediaId, async (v) => {
    await keepMediaWithheld(v);
    return "Kept withheld — it won't be used publicly.";
  });
}

export async function withdrawConsentAction(input: { testimonialId: string; reason: string }): Promise<ActionResult> {
  return run(z.object({ testimonialId: id, reason: note.max(500) }), input, async (v) => {
    await withdrawTestimonialConsent(v.testimonialId, v.reason || undefined);
    return "Consent withdrawn. Anything public for this job is being taken down.";
  });
}

export async function approveMessageAction(messageId: string): Promise<ActionResult> {
  return run(id, messageId, async (v) => {
    const status = await approveMessage(v);
    if (status === "cancelled") return "Not sent: the homeowner has opted out, so the message was cancelled.";
    if (status === "failed") throw new DashboardError("Approved, but delivery failed — see the sent log.");
    return "Approved and sent.";
  });
}

export async function cancelMessageAction(messageId: string): Promise<ActionResult> {
  return run(id, messageId, async (v) => {
    await cancelMessage(v);
    return "Message cancelled — it will not be sent.";
  });
}
