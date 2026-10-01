/**
 * Consent withdrawal (UK GDPR: as easy to withdraw as to give). The homeowner does it from their /r/<token>
 * page; the agency can do it from the dashboard when asked by phone or email.
 * Effect: every consent flag goes false (the original wording stays as evidence of what was agreed and when),
 * nothing of the job stays in review, and everything already published is queued for takedown.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { enqueueUnpublish } from "@/lib/tasks/enqueue";
import { getTestimonialByToken } from "./index";
import { notifyOwner } from "./owner";

export type WithdrawResult = {
  testimonialId: string;
  jobId: string;
  /** True when consent had already been withdrawn (the takedown is still re-checked). */
  alreadyWithdrawn: boolean;
  /** Asset ids moved to "rejected" (drafts, in review, approved-but-unpublished). */
  rejected: string[];
  /** Published asset ids queued for unpublishing. */
  unpublishQueued: string[];
};

/**
 * Take a job's assets out of circulation: unpublished ones are rejected, published ones get an
 * "asset.unpublish" task. Idempotent (tasks are de-duplicated per asset).
 */
export async function retractJobAssets(
  jobId: string,
  reason: string,
  actor: string,
): Promise<{ rejected: string[]; unpublishQueued: string[] }> {
  const db = await getDb();
  const note = `Withdrawn: ${reason}`;
  const out = await db.transaction(async (tx) => {
    const rejected = await tx
      .update(schema.assets)
      .set({ status: "rejected", reviewNotes: note, updatedAt: new Date() })
      .where(and(eq(schema.assets.jobId, jobId), inArray(schema.assets.status, ["draft", "in_review", "approved"])))
      .returning({ id: schema.assets.id, tenantId: schema.assets.tenantId, type: schema.assets.type });
    const published = await tx
      .select({ id: schema.assets.id, tenantId: schema.assets.tenantId })
      .from(schema.assets)
      .where(and(eq(schema.assets.jobId, jobId), eq(schema.assets.status, "published")));
    for (const a of published) await enqueueUnpublish(a.tenantId, a.id, reason, { executor: tx });
    return { rejected, published };
  });
  for (const a of out.rejected) {
    await logEvent({ tenantId: a.tenantId, type: "asset.rejected", entity: "asset", entityId: a.id, actor, data: { jobId, type: a.type, reason, cause: "consent" } });
  }
  return { rejected: out.rejected.map((a) => a.id), unpublishQueued: out.published.map((a) => a.id) };
}

export async function withdrawConsent(testimonialId: string, actor: string, reason?: string): Promise<WithdrawResult> {
  const db = await getDb();
  const [t] = await db.select().from(schema.testimonials).where(eq(schema.testimonials.id, testimonialId));
  if (!t) throw new Error(`Testimonial ${testimonialId} not found`);
  const why = reason?.trim().slice(0, 500) || "Homeowner withdrew permission";

  const [updated] = await db
    .update(schema.testimonials)
    .set({ withdrawnAt: new Date(), consentPhotos: false, consentArea: false, consentFirstName: false, consentQuote: false })
    .where(and(eq(schema.testimonials.id, t.id), isNull(schema.testimonials.withdrawnAt)))
    .returning();

  if (updated) {
    await logEvent({
      tenantId: t.tenantId,
      type: "consent.withdrawn",
      entity: "testimonial",
      entityId: t.id,
      actor,
      data: {
        jobId: t.jobId,
        reason: why,
        previous: { photos: t.consentPhotos, area: t.consentArea, firstName: t.consentFirstName, quote: t.consentQuote },
        now: { photos: false, area: false, firstName: false, quote: false },
      },
    });
  }
  const retracted = await retractJobAssets(t.jobId, why, actor);

  if (updated) {
    const [job] = await db.select({ code: schema.jobs.code }).from(schema.jobs).where(eq(schema.jobs.id, t.jobId));
    await notifyOwner(
      t.tenantId,
      `Consent withdrawn on ${job?.code ?? "a job"}: the homeowner no longer wants their garden shared. ` +
        `${retracted.unpublishQueued.length} published item(s) are being taken down; nothing else will be used.`,
    );
  }
  return { testimonialId: t.id, jobId: t.jobId, alreadyWithdrawn: !updated, ...retracted };
}

/** From the homeowner's own page: the link token is the credential. Null if there is nothing to withdraw. */
export async function withdrawConsentByToken(token: string): Promise<WithdrawResult | null> {
  const t = await getTestimonialByToken(token);
  if (!t || t.status !== "responded") return null;
  return withdrawConsent(t.id, t.customerId ?? "homeowner", "Homeowner withdrew permission from their review link");
}
