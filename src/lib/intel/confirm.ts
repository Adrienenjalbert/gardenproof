/**
 * The owner's edits on the "check what we found" screen. They may correct words (name, tagline, about, contact,
 * services, areas, CTA) and REMOVE things (a badge, a review source, a featured review, a project), but they can't
 * make proof up: a badge only stays verified if we verified it, review sources and featured reviews must be ones
 * we found (with our numbers), and the headline rating is always recomputed.
 */
import { z } from "zod";
import { aggregateRating } from "./ratings";
import { BadgeSchema, BusinessProfileSchema, PublicReviewSchema, ReviewSourceSchema, ScrapedProjectSchema, type BusinessProfile } from "./types";

const P = BusinessProfileSchema.shape;

export const OnboardingEditsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    legalName: P.legalName,
    companyNumber: P.companyNumber,
    yearsTrading: z.number().int().min(0).max(200).nullable(),
    tagline: z.string().trim().max(200).nullable(),
    about: z.string().trim().max(3000).nullable(),
    contact: P.contact,
    services: P.services.max(30),
    areas: P.areas.max(60),
    cta: z.object({ text: z.string().trim().min(1).max(60), url: z.string().trim().url() }),
    social: P.social,
    badges: z.array(BadgeSchema),
    reviews: z.object({ sources: z.array(ReviewSourceSchema), featured: z.array(PublicReviewSchema) }),
    projects: z.array(ScrapedProjectSchema),
  })
  .partial()
  .strict();
export type OnboardingEdits = z.infer<typeof OnboardingEditsSchema>;

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** Merge edits into the draft, keeping every piece of proof honest. Returns a schema-valid profile. */
export function applyOwnerEdits(draft: BusinessProfile, edits: OnboardingEdits): BusinessProfile {
  const next: BusinessProfile = { ...draft, ...edits, reviews: draft.reviews } as BusinessProfile;

  if (edits.badges) {
    next.badges = edits.badges.map((b) => {
      const found = draft.badges.find((d) => d.body === b.body && (b.body !== "other" || d.name === b.name));
      if (found?.verified) return { ...b, verified: true, status: "verified", profileUrl: found.profileUrl, evidence: found.evidence, rating: found.rating, reviewCount: found.reviewCount, imageUrl: found.imageUrl, imageKey: found.imageKey };
      // Anything we didn't verify stays "claimed" and keeps only our evidence / image (never an uploaded logo URL).
      return { ...b, verified: false, status: "claimed", evidence: found?.evidence ?? [], imageUrl: found?.imageUrl ?? null, imageKey: found?.imageKey ?? null, rating: null, reviewCount: null, profileUrl: b.profileUrl ?? found?.profileUrl ?? null };
    });
  }
  if (edits.reviews) {
    const sources = edits.reviews.sources
      .map((s) => draft.reviews.sources.find((d) => d.provider === s.provider && sameUrl(d.url, s.url)))
      .filter((s): s is BusinessProfile["reviews"]["sources"][number] => Boolean(s));
    const featured = edits.reviews.featured
      .map((r) => draft.reviews.featured.find((d) => sameUrl(d.url, r.url) && d.text === r.text))
      .filter((r): r is BusinessProfile["reviews"]["featured"][number] => Boolean(r));
    next.reviews = { sources, featured, aggregate: aggregateRating(sources) };
  }
  if (edits.projects) {
    // Projects can be removed, reordered or retitled; photos must be ones we collected.
    const known = new Set(draft.projects.flatMap((p) => p.images.map((i) => i.key ?? i.url)));
    next.projects = edits.projects.map((p) => ({ ...p, images: p.images.filter((i) => known.has(i.key ?? i.url)) })).filter((p) => p.images.length > 0);
  }
  // Warnings and rejected look-alikes are ours, never editable; source stays as scraped.
  next.warnings = draft.warnings;
  next.rejected = draft.rejected;
  next.source = draft.source;
  next.shell = draft.shell;
  next.brand = draft.brand;
  return BusinessProfileSchema.parse(next);
}
