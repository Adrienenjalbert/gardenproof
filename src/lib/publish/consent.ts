/**
 * Render-time consent gate (defence in depth: the content engine gates drafts too, but content can be edited
 * or drafted before the homeowner answered, and consent can be withdrawn after publishing).
 *
 * Applied to every public view (preview, /portfolio, JSON feed, WordPress payload, JSON-LD):
 *  - quote: shown only with an explicit `consentQuote` yes (no row, no answer or "no" → no testimonial block);
 *  - first name: only with `consentFirstName`, otherwise the attribution becomes "Homeowner[, area]";
 *  - photos: dropped when the homeowner said no to photos;
 *  - withdrawn: nothing from the job is public at all.
 */
import { desc, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Testimonial } from "@/db/schema";
import type { PortfolioView } from "./view";

export type PublicConsent = {
  withdrawn: boolean;
  /** null: the homeowner has not answered (the consent-photos check decides). */
  photos: boolean | null;
  quote: boolean;
  firstName: boolean;
};

export const NO_CONSENT: PublicConsent = { withdrawn: false, photos: null, quote: false, firstName: false };

type ConsentRow = Pick<
  Testimonial,
  "jobId" | "status" | "consentPhotos" | "consentQuote" | "consentFirstName" | "withdrawnAt"
>;

/** Rows newest first. Any withdrawal wins; otherwise the latest answered request decides. */
export function consentFromRows(rows: ConsentRow[]): PublicConsent {
  if (rows.some((r) => r.withdrawnAt)) return { withdrawn: true, photos: false, quote: false, firstName: false };
  const answered = rows.find((r) => r.status === "responded");
  if (!answered) return NO_CONSENT;
  return {
    withdrawn: false,
    photos: answered.consentPhotos ?? null,
    quote: answered.consentQuote === true,
    firstName: answered.consentFirstName === true,
  };
}

export async function loadPublicConsent(jobIds: string[]): Promise<Map<string, PublicConsent>> {
  const out = new Map<string, PublicConsent>();
  if (!jobIds.length) return out;
  const db = await getDb();
  const rows = await db
    .select({
      jobId: schema.testimonials.jobId,
      status: schema.testimonials.status,
      consentPhotos: schema.testimonials.consentPhotos,
      consentQuote: schema.testimonials.consentQuote,
      consentFirstName: schema.testimonials.consentFirstName,
      withdrawnAt: schema.testimonials.withdrawnAt,
      createdAt: schema.testimonials.createdAt,
    })
    .from(schema.testimonials)
    .where(inArray(schema.testimonials.jobId, jobIds))
    .orderBy(desc(schema.testimonials.createdAt));
  for (const jobId of jobIds) out.set(jobId, consentFromRows(rows.filter((r) => r.jobId === jobId)));
  return out;
}

/** Strip whatever the homeowner has not agreed to show. Pure. */
export function applyConsent(view: PortfolioView, consent: PublicConsent): PortfolioView {
  const noPhotos = consent.withdrawn || consent.photos === false;
  let testimonial = consent.quote && !consent.withdrawn ? view.testimonial : null;
  if (testimonial && !consent.firstName) {
    testimonial = { ...testimonial, attribution: view.facts.area ? `Homeowner, ${view.facts.area}` : "Homeowner" };
  }
  return {
    ...view,
    testimonial,
    ...(noPhotos ? { hero: null, beforeAfter: null, gallery: [] } : {}),
  };
}
