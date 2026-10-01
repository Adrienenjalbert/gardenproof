/**
 * Consent gating — pure. Decides what of the homeowner's data may appear in public copy.
 *
 * Rules (BUILD_BRIEF "Consent first"):
 * - consentPhotos === false          -> the job gets NO public assets at all.
 * - withdrawnAt set                  -> same as a photo refusal: nothing public (and it is logged).
 * - no response yet / expired        -> generate without testimonial, generic area, and flag that
 *                                       photo consent is unconfirmed so the reviewer holds publishing.
 * - quote + rating                   -> ONE permission (see testimonialPermission): a responded,
 *                                       not-withdrawn testimonial with consentQuote === true and
 *                                       rating >= MIN_PUBLIC_RATING. The rating/stars are never shown
 *                                       without the quote permission either: the homeowner agreed to
 *                                       "quote my review", so we treat review text + score as one thing.
 * - first name                       -> only if consentFirstName; otherwise "Homeowner".
 * - area name / outward code         -> only if consentArea; otherwise GENERIC_AREA.
 * - street address / house number    -> never (not even passed to the copywriter).
 */
import type { Customer, Job, Testimonial } from "@/db/schema";
import { areaFromPostcode, type TenantConfig } from "@/lib/tenant";
import type { Check, ContextTestimonial } from "./types";

export const GENERIC_AREA = "South West London";
/** A 3-star review is honest feedback, not proof to advertise. */
export const MIN_PUBLIC_RATING = 4;

export type ConsentInput = {
  job: Pick<Job, "area" | "postcode">;
  customer: Pick<Customer, "firstName" | "lastName"> | null;
  testimonial: Pick<
    Testimonial,
    "status" | "rating" | "quote" | "consentPhotos" | "consentArea" | "consentFirstName" | "consentQuote" | "withdrawnAt"
  > | null;
  config: TenantConfig;
};

type TestimonialGate = Pick<Testimonial, "status" | "rating" | "quote" | "consentQuote" | "withdrawnAt">;

/**
 * The single rule for using the homeowner's words or score publicly (copy AND videos).
 * Returns the trimmed quote + rating when allowed, or the reason it is withheld (for reviewer notes).
 */
export function testimonialPermission(
  t: TestimonialGate | null | undefined,
): { ok: true; quote: string; rating: number } | { ok: false; reason: string | null } {
  if (!t || t.status !== "responded") return { ok: false, reason: null };
  if (t.withdrawnAt) return { ok: false, reason: "the homeowner withdrew their consent" };
  const quote = t.quote?.replace(/\s+/g, " ").trim() ?? "";
  if (!quote || !t.rating) return { ok: false, reason: null };
  if (t.consentQuote !== true) return { ok: false, reason: "the homeowner did not give permission to quote their words" };
  if (t.rating < MIN_PUBLIC_RATING) return { ok: false, reason: `rating ${t.rating}/5 is below the public threshold of ${MIN_PUBLIC_RATING}` };
  return { ok: true, quote, rating: t.rating };
}

export type ConsentDecision = {
  publicAllowed: boolean;
  /** Why nothing may be public (when publicAllowed is false). */
  refusal: null | "photos_refused" | "withdrawn";
  photoConsent: "given" | "unconfirmed" | "refused";
  area: { name: string; named: boolean; outwardCode: string | null };
  /** The job's real area, kept only so lint can make sure it does not leak when not consented. */
  privateArea: string | null;
  firstName: string | null;
  testimonial: ContextTestimonial | null;
  forbidden: { term: string; reason: string }[];
  notes: Check[];
};

export function outwardCode(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const compact = postcode.toUpperCase().replace(/\s+/g, "");
  const m = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})?$/);
  return m ? m[1] : null;
}

export function decideConsent({ job, customer, testimonial: t, config }: ConsentInput): ConsentDecision {
  const notes: Check[] = [];
  const forbidden: ConsentDecision["forbidden"] = [];
  const withdrawn = !!t?.withdrawnAt;
  const responded = t?.status === "responded" && !withdrawn;
  const privateArea = job.area ?? areaFromPostcode(job.postcode, config);

  if (customer?.lastName) forbidden.push({ term: customer.lastName, reason: "customer surname is never public" });

  const photoConsent: ConsentDecision["photoConsent"] =
    responded && t?.consentPhotos === false ? "refused" : responded && t?.consentPhotos === true ? "given" : "unconfirmed";

  const areaOk = responded && t?.consentArea === true && !!privateArea;
  const area = areaOk
    ? { name: privateArea!, named: true, outwardCode: outwardCode(job.postcode) }
    : { name: GENERIC_AREA, named: false, outwardCode: null };
  if (!areaOk && privateArea) {
    forbidden.push({ term: privateArea, reason: "homeowner has not consented to naming the area" });
    const oc = outwardCode(job.postcode);
    if (oc) forbidden.push({ term: oc, reason: "homeowner has not consented to naming the area" });
  }

  const firstName = responded && t?.consentFirstName === true && customer?.firstName ? customer.firstName : null;
  if (!firstName && customer?.firstName) {
    forbidden.push({ term: customer.firstName, reason: "homeowner has not consented to using their first name" });
  }

  let testimonial: ContextTestimonial | null = null;
  const permission = testimonialPermission(t);
  if (permission.ok) {
    testimonial = { quote: permission.quote, rating: permission.rating, attribution: `${firstName ?? "Homeowner"}, ${area.name}` };
  } else if (permission.reason && !withdrawn) {
    notes.push({ id: "testimonial-withheld", ok: true, message: `Testimonial not used (no quote, rating or stars): ${permission.reason}.` });
  }

  if (photoConsent === "unconfirmed") {
    notes.push({
      id: "consent-photos",
      ok: false,
      message: "Homeowner has not confirmed photo consent yet — do not publish until they do.",
    });
  }
  if (!responded) {
    notes.push({ id: "consent-testimonial", ok: true, message: "No testimonial response yet: copy written without quote, name or area." });
  }

  if (withdrawn) {
    notes.push({ id: "consent-withdrawn", ok: false, message: "The homeowner withdrew consent: nothing about this job may be public." });
  }

  return {
    publicAllowed: photoConsent !== "refused" && !withdrawn,
    refusal: withdrawn ? "withdrawn" : photoConsent === "refused" ? "photos_refused" : null,
    photoConsent,
    area,
    privateArea,
    firstName,
    testimonial,
    forbidden,
    notes,
  };
}
