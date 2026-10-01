/**
 * Homeowner testimonial loop.
 *   requestTestimonial  -> token + warm WhatsApp from the business (held in safe mode) with /r/<token>
 *   submitTestimonial   -> rating, optional quote, granular consent (exact wording logged) -> content task
 *   expireStaleTestimonials -> 48h silence moves the job on to content without a testimonial
 *   withdrawConsent     -> (./withdraw) the homeowner or agency takes consent back; everything public comes down
 * Ratings >= 4 are offered public review links; <= 3 stay private and go to the owner personally.
 */
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Message, Testimonial } from "@/db/schema";
import { env } from "@/lib/config";
import { notifyOwner } from "@/lib/crm-engine/notify";
import { logEvent } from "@/lib/events";
import { newId, newToken } from "@/lib/ids";
import { sendMessage } from "@/lib/messaging";
import { publicUrl } from "@/lib/storage";
import { enqueueReadyForContent } from "@/lib/tasks/enqueue";
import { getTenant } from "@/lib/tenants";
import { consentWording, quoteConsentApplies } from "./consent";
import { ownerOf } from "./owner";

export { withdrawConsent, withdrawConsentByToken, retractJobAssets } from "./withdraw";
export type { WithdrawResult } from "./withdraw";

export const TESTIMONIAL_TTL_MS = 48 * 3600_000;
export const QUOTE_MAX = 280;

export const TestimonialInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  quote: z
    .string()
    .trim()
    .max(QUOTE_MAX, `Please keep it to ${QUOTE_MAX} characters`)
    .optional()
    .transform((v) => (v ? v : undefined)),
  consentPhotos: z.boolean(),
  consentArea: z.boolean(),
  consentFirstName: z.boolean(),
  /** Asked only when there is a publishable quote (4-5 stars and some words); otherwise it is recorded as NO. */
  consentQuote: z.boolean().optional(),
  maintenanceInterest: z.boolean().nullable().optional(),
})
  .superRefine((v, ctx) => {
    if (quoteConsentApplies(v.rating, v.quote) && v.consentQuote === undefined) {
      ctx.addIssue({ code: "custom", path: ["consentQuote"], message: "Please say whether we may quote your words" });
    }
  })
  .transform((v) => ({ ...v, consentQuote: quoteConsentApplies(v.rating, v.quote) ? (v.consentQuote ?? false) : false }));
export type TestimonialInput = z.input<typeof TestimonialInputSchema>;

/** Past its 48h window, even if the expiry sweep hasn't run yet. */
const isLapsed = (t: Testimonial, now = Date.now()) =>
  t.status === "sent" && t.sentAt !== null && now - t.sentAt.getTime() > TESTIMONIAL_TTL_MS;

export const reviewLinkPath = (token: string) => `/r/${token}`;

/** Typed link stored on the outbound request message (messages.meta). */
export type ReviewRequestMeta = { kind: "review_request"; testimonialId: string; jobId: string };

const isReviewRequestMeta = (m: unknown): m is ReviewRequestMeta =>
  typeof m === "object" && m !== null && (m as ReviewRequestMeta).kind === "review_request" && typeof (m as ReviewRequestMeta).testimonialId === "string";

/**
 * The homeowner request, as WhatsApp template variables and as text. The text is exactly what the approved
 * template renders (see docs/DEPLOY.md), so what the agency approves in safe mode is what the homeowner reads.
 */
export function reviewRequestVariables(v: { firstName: string | null; from: string; link: string }): Record<string, string> {
  return { "1": v.firstName ?? "there", "2": v.from, "3": v.link };
}
export function reviewRequestText(vars: Record<string, string>): string {
  return (
    `Hi ${vars["1"]}, it's ${vars["2"]}. Thank you for having us in your garden, it was a real pleasure to work on. ` +
    `Would you tell us how it feels now? It takes about 30 seconds: ${vars["3"]}\n\nThank you.`
  );
}

async function moveToContent(tenantId: string, jobId: string, reason: string): Promise<void> {
  await enqueueReadyForContent(tenantId, jobId);
  await logEvent({ tenantId, type: "pipeline.content_queued", entity: "job", entityId: jobId, data: { reason } });
}

async function heroAfterUrl(jobId: string, absolute = false): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.jobId, jobId), eq(schema.media.stage, "after"), eq(schema.media.kind, "image")))
    .orderBy(desc(schema.media.isHero), asc(schema.media.createdAt));
  const hero = rows.find((m) => m.publicKey) ?? null;
  return hero?.publicKey ? publicUrl(hero.publicKey, absolute) : null;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------
export async function requestTestimonial(jobId: string): Promise<boolean> {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) throw new Error(`Job ${jobId} not found`);

  // Idempotent: one live request per job.
  const [existing] = await db
    .select()
    .from(schema.testimonials)
    .where(eq(schema.testimonials.jobId, jobId))
    .orderBy(desc(schema.testimonials.createdAt));
  if (existing && existing.status !== "expired") return true;

  const [customer] = job.customerId
    ? await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId))
    : [];
  const skip = !customer ? "no_customer" : !customer.phone ? "no_phone" : customer.optedOut ? "opted_out" : null;
  if (skip || !customer?.phone) {
    await logEvent({ tenantId: job.tenantId, type: "testimonial.skipped", entity: "job", entityId: jobId, data: { reason: skip } });
    return false;
  }

  const tenant = await getTenant(job.tenantId);
  const owner = await ownerOf(job.tenantId);
  const token = newToken();
  const testimonialId = newId("tst");
  await db.insert(schema.testimonials).values({
    id: testimonialId,
    tenantId: job.tenantId,
    jobId,
    customerId: customer.id,
    token,
    status: "pending",
  });
  await db.update(schema.jobs).set({ status: "awaiting_testimonial", updatedAt: new Date() }).where(eq(schema.jobs.id, jobId));

  const from = owner ? `${owner.name} at ${tenant.name}` : `the team at ${tenant.name}`;
  const variables = reviewRequestVariables({ firstName: customer.firstName, from, link: `${env.appUrl}${reviewLinkPath(token)}` });
  const templateSid = env.twilio.reviewRequestTemplateSid;
  const hero = await heroAfterUrl(jobId);
  const meta: ReviewRequestMeta = { kind: "review_request", testimonialId, jobId };
  const msg = await sendMessage({
    tenantId: job.tenantId,
    to: customer.phone,
    body: reviewRequestText(variables),
    audience: "customer",
    meta,
    // Outside WhatsApp's 24h window only an approved template gets through (Twilio error 63016 otherwise).
    // A text-only template carries no photo, so the hero image is only attached to free-form sends.
    ...(templateSid ? { template: { sid: templateSid, variables } } : hero ? { mediaUrls: [hero] } : {}),
  });

  await logEvent({ tenantId: job.tenantId, type: "testimonial.requested", entity: "testimonial", entityId: testimonialId, data: { jobId, messageId: msg.id, messageStatus: msg.status } });
  if (msg.status === "sent") {
    await db.update(schema.testimonials).set({ status: "sent", sentAt: new Date() }).where(eq(schema.testimonials.id, testimonialId));
  } else if (msg.status === "failed" || msg.status === "cancelled") {
    await db.update(schema.testimonials).set({ status: "expired" }).where(eq(schema.testimonials.id, testimonialId));
    return false;
  }
  return true;
}

/**
 * Called by messaging when a held message is approved or cancelled. Keeps the testimonial clock
 * honest: the 48h window starts when the homeowner actually receives the link.
 */
export async function syncTestimonialWithMessage(msg: Message): Promise<void> {
  if (msg.direction !== "out" || !isReviewRequestMeta(msg.meta)) return;
  const db = await getDb();
  const [t] = await db.select().from(schema.testimonials).where(eq(schema.testimonials.id, msg.meta.testimonialId));
  if (!t || t.status !== "pending") return;
  if (msg.status === "sent") {
    await db.update(schema.testimonials).set({ status: "sent", sentAt: new Date() }).where(eq(schema.testimonials.id, t.id));
  } else if (msg.status === "cancelled" || msg.status === "failed") {
    await db.update(schema.testimonials).set({ status: "expired" }).where(eq(schema.testimonials.id, t.id));
    await logEvent({ tenantId: t.tenantId, type: "testimonial.withdrawn", entity: "testimonial", entityId: t.id, data: { messageStatus: msg.status } });
    await moveToContent(t.tenantId, t.jobId, "request_not_sent");
  }
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------
export type ReviewLinks = { google: string | null; which: string | null };

export type SubmitResult =
  | { ok: true; rating: number; alreadySubmitted: boolean; reviewLinks: ReviewLinks }
  | { ok: false; reason: "invalid" | "expired" | "validation"; message: string; fieldErrors?: Record<string, string> };

function linksFor(rating: number, proof: { googleReviewUrl: string | null; whichUrl: string | null }): ReviewLinks {
  // Low ratings never get pushed towards public review sites: they go privately to the owner.
  if (rating < 4) return { google: null, which: null };
  return { google: proof.googleReviewUrl, which: proof.whichUrl };
}

export async function getTestimonialByToken(token: string): Promise<Testimonial | null> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  const db = await getDb();
  const [t] = await db.select().from(schema.testimonials).where(eq(schema.testimonials.token, token));
  return t ?? null;
}

export async function submitTestimonial(token: string, raw: unknown): Promise<SubmitResult> {
  const t = await getTestimonialByToken(token);
  if (!t) return { ok: false, reason: "invalid", message: "This link isn't valid." };
  const tenant = await getTenant(t.tenantId);

  if (t.status === "responded") {
    return { ok: true, rating: t.rating ?? 5, alreadySubmitted: true, reviewLinks: linksFor(t.rating ?? 0, tenant.config.proof) };
  }
  if (t.status === "expired" || isLapsed(t)) return { ok: false, reason: "expired", message: "This link has expired." };

  const parsed = TestimonialInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, reason: "validation", message: "Please check the highlighted answers.", fieldErrors };
  }
  const input = parsed.data;

  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, t.jobId));
  const now = new Date();
  const wording = consentWording(tenant.name, job?.area ?? null, input, { quoteAsked: quoteConsentApplies(input.rating, input.quote) });

  // The answer and the content task commit together: a crash can't leave a response with no content queued.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.testimonials)
      .set({
        status: "responded",
        rating: input.rating,
        quote: input.quote ?? null,
        consentPhotos: input.consentPhotos,
        consentArea: input.consentArea,
        consentFirstName: input.consentFirstName,
        consentQuote: input.consentQuote,
        consentWording: wording,
        consentedAt: now,
        maintenanceInterest: input.maintenanceInterest ?? null,
        respondedAt: now,
      })
      // Guard against a double submit racing: only the first write wins.
      .where(and(eq(schema.testimonials.id, t.id), eq(schema.testimonials.status, t.status)))
      .returning();
    if (row) await enqueueReadyForContent(t.tenantId, t.jobId, { executor: tx });
    return row;
  });
  if (!updated) return { ok: true, rating: input.rating, alreadySubmitted: true, reviewLinks: linksFor(input.rating, tenant.config.proof) };

  await logEvent({
    tenantId: t.tenantId,
    type: "consent.recorded",
    entity: "testimonial",
    entityId: t.id,
    actor: t.customerId ?? "homeowner",
    data: { jobId: t.jobId, photos: input.consentPhotos, area: input.consentArea, firstName: input.consentFirstName, quote: input.consentQuote, wording },
  });
  await logEvent({ tenantId: t.tenantId, type: "testimonial.received", entity: "testimonial", entityId: t.id, data: { jobId: t.jobId, rating: input.rating, hasQuote: Boolean(input.quote) } });
  if (input.maintenanceInterest) {
    await logEvent({ tenantId: t.tenantId, type: "lead.maintenance_interest", entity: "customer", entityId: t.customerId ?? undefined, data: { jobId: t.jobId } });
  }

  if (input.rating <= 3) await notifyOwnerOfLowRating(t, input.rating, input.quote ?? null, job?.code ?? null);
  else if (input.maintenanceInterest) {
    await notifyOwner(t.tenantId, "info", `Good news${job ? ` on ${job.code}` : ""}: the homeowner would like seasonal maintenance. Worth a call.`);
  }

  return { ok: true, rating: input.rating, alreadySubmitted: false, reviewLinks: linksFor(input.rating, tenant.config.proof) };
}

async function notifyOwnerOfLowRating(t: Testimonial, rating: number, quote: string | null, code: string | null) {
  const db = await getDb();
  const [customer] = t.customerId ? await db.select().from(schema.customers).where(eq(schema.customers.id, t.customerId)) : [];
  const who = customer?.firstName ?? "The homeowner";
  const said = quote ? ` They said: "${quote}"` : "";
  await logEvent({ tenantId: t.tenantId, type: "testimonial.low_rating", entity: "testimonial", entityId: t.id, data: { rating } });
  await notifyOwner(
    t.tenantId,
    "low_review",
    `Private feedback on ${code ?? "a recent job"}: ${who} rated it ${rating}/5.${said} A personal call is worth it.`,
  );
}

/** Records which public review site a happy homeowner clicked; returns the URL to redirect to. */
export async function recordReviewClick(token: string, site: "google" | "which"): Promise<string | null> {
  const t = await getTestimonialByToken(token);
  if (!t || t.status !== "responded" || (t.rating ?? 0) < 4) return null;
  const tenant = await getTenant(t.tenantId);
  const url = site === "google" ? tenant.config.proof.googleReviewUrl : tenant.config.proof.whichUrl;
  if (!url) return null;
  const db = await getDb();
  await db.update(schema.testimonials).set({ reviewLinkClicked: site }).where(eq(schema.testimonials.id, t.id));
  await logEvent({ tenantId: t.tenantId, type: "review.clicked", entity: "testimonial", entityId: t.id, data: { site } });
  return url;
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------
/**
 * 48h after the link was delivered with no answer: mark expired and move the job on. Returns how many expired.
 * The status flip and the content task commit in one transaction, so a failure leaves the testimonial "sent"
 * and the next sweep tries again (never "expired" with no content queued).
 */
export async function expireStaleTestimonials(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - TESTIMONIAL_TTL_MS);
  const stale = await db
    .select()
    .from(schema.testimonials)
    .where(and(eq(schema.testimonials.status, "sent"), lt(schema.testimonials.sentAt, cutoff)));
  let expired = 0;
  for (const t of stale) {
    const outcome = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.testimonials)
        .set({ status: "expired" })
        .where(and(eq(schema.testimonials.id, t.id), eq(schema.testimonials.status, "sent")))
        .returning();
      if (!updated) return null;
      const [job] = await tx.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, t.jobId));
      const queue = job?.status === "awaiting_testimonial";
      if (queue) await enqueueReadyForContent(t.tenantId, t.jobId, { executor: tx });
      return { queued: queue };
    });
    if (!outcome) continue;
    expired++;
    await logEvent({ tenantId: t.tenantId, type: "testimonial.expired", entity: "testimonial", entityId: t.id, data: { jobId: t.jobId, contentQueued: outcome.queued } });
  }
  return expired;
}

// ---------------------------------------------------------------------------
// View model for /r/[token]
// ---------------------------------------------------------------------------
export type TestimonialView = {
  state: "open" | "responded" | "expired";
  /** Homeowner took their permission back (the page then offers nothing further to withdraw). */
  withdrawn: boolean;
  /** Something was agreed that can still be withdrawn. */
  canWithdraw: boolean;
  token: string;
  businessName: string;
  logoPath: string;
  firstName: string | null;
  area: string | null;
  heroUrl: string | null;
  completedAt: Date | null;
  rating: number | null;
  /** The homeowner's own words (only ever shown back to them, on their private link). */
  quote: string | null;
  reviewLinks: ReviewLinks;
  phone: string | null;
  website: string;
  /** Who a low rating goes to ("Stephen will be in touch"). */
  ownerFirstName: string | null;
};

export async function getTestimonialView(token: string): Promise<TestimonialView | null> {
  const t = await getTestimonialByToken(token);
  if (!t) return null;
  const db = await getDb();
  const tenant = await getTenant(t.tenantId);
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, t.jobId));
  const [customer] = t.customerId ? await db.select().from(schema.customers).where(eq(schema.customers.id, t.customerId)) : [];
  const state = t.status === "responded" ? "responded" : t.status === "expired" || isLapsed(t) ? "expired" : "open";
  const anyConsent = Boolean(t.consentPhotos || t.consentArea || t.consentFirstName || t.consentQuote);
  return {
    state,
    withdrawn: t.withdrawnAt !== null,
    canWithdraw: state === "responded" && t.withdrawnAt === null && anyConsent,
    token,
    businessName: tenant.name,
    logoPath: tenant.config.brand.logoPath,
    firstName: customer?.firstName ?? null,
    area: job?.area ?? null,
    heroUrl: await heroAfterUrl(t.jobId),
    completedAt: job?.completedAt ?? null,
    rating: t.rating,
    quote: t.quote ?? null,
    reviewLinks: linksFor(t.rating ?? 0, tenant.config.proof),
    phone: tenant.config.phone,
    website: tenant.config.website,
    ownerFirstName: (await ownerOf(t.tenantId))?.name ?? null,
  };
}
