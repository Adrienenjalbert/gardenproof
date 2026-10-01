/**
 * BusinessProfile — everything GardenProof learns about a business from its website URL and the public web.
 * Produced by the intel pipeline (onboarding), confirmed by the owner, stored in tenants.profile.
 * Every externally sourced fact carries evidence (URL) so the UI can show where it came from.
 */
import { z } from "zod";

export const EvidenceSchema = z.object({ url: z.string(), note: z.string().optional() });

export const BADGE_BODIES = [
  "which", // Which? Trusted Traders
  "checkatrade",
  "trustmark",
  "apl", // Association of Professional Landscapers
  "hta", // Horticultural Trades Association
  "bali", // British Association of Landscape Industries
  "safecontractor",
  "trustatrader",
  "fmb", // Federation of Master Builders
  "other",
] as const;
export type BadgeBody = (typeof BADGE_BODIES)[number];

export const REVIEW_PROVIDERS = [
  "google",
  "which",
  "checkatrade",
  "trustmark",
  "trustpilot",
  "houzz",
  "facebook",
  "yell",
  "website",
  "other",
] as const;
export type ReviewProvider = (typeof REVIEW_PROVIDERS)[number];

export const BadgeSchema = z.object({
  body: z.enum(BADGE_BODIES),
  name: z.string(), // "Which? Trusted Trader"
  /** verified = confirmed on the accrediting body's own site for THIS business (name + postcode/phone match). */
  verified: z.boolean(),
  status: z.enum(["verified", "claimed", "not_found"]), // claimed = only the business says so
  profileUrl: z.string().nullable(), // the business's page on the body's site
  evidence: z.array(EvidenceSchema).default([]),
  /** Official badge image as shown on the business's own site (never recreated). */
  imageUrl: z.string().nullable().default(null),
  imageKey: z.string().nullable().default(null), // stored copy
  rating: z.number().nullable().default(null),
  reviewCount: z.number().int().nullable().default(null),
});
export type Badge = z.infer<typeof BadgeSchema>;

export const ReviewSourceSchema = z.object({
  provider: z.enum(REVIEW_PROVIDERS),
  url: z.string(),
  rating: z.number().nullable(), // out of 5 (normalise 10-point scales)
  count: z.number().int().nullable(),
  matched: z.object({ by: z.array(z.enum(["name", "postcode", "phone", "website", "company_number"])), confidence: z.number() }),
});
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;

export const PublicReviewSchema = z.object({
  provider: z.enum(REVIEW_PROVIDERS),
  author: z.string().nullable(), // as displayed publicly (e.g. "Hedley, London")
  text: z.string(),
  rating: z.number().nullable(),
  date: z.string().nullable(),
  url: z.string(),
});
export type PublicReview = z.infer<typeof PublicReviewSchema>;

export const ScrapedProjectSchema = z.object({
  title: z.string(),
  url: z.string(),
  category: z.string().nullable(),
  area: z.string().nullable(),
  summary: z.string().nullable(),
  images: z.array(z.object({ url: z.string(), key: z.string().nullable(), alt: z.string().nullable(), width: z.number().nullable(), height: z.number().nullable() })),
});
export type ScrapedProject = z.infer<typeof ScrapedProjectSchema>;

export const BusinessProfileSchema = z.object({
  version: z.literal(1),
  source: z.object({ url: z.string(), scrapedAt: z.string() }),
  name: z.string(),
  legalName: z.string().nullable(),
  companyNumber: z.string().nullable(),
  yearsTrading: z.number().nullable(),
  tagline: z.string().nullable(),
  about: z.string().nullable(),
  contact: z.object({
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    postcode: z.string().nullable(),
  }),
  brand: z.object({
    colors: z.object({
      primary: z.string(),
      secondary: z.string().nullable(),
      accent: z.string().nullable(),
      background: z.string(),
      text: z.string(),
    }),
    fonts: z.object({ heading: z.string().nullable(), body: z.string().nullable() }),
    logoUrl: z.string().nullable(),
    logoKey: z.string().nullable(),
    faviconUrl: z.string().nullable(),
    buttonRadius: z.string().nullable(),
  }),
  /** Header/footer cloned from their homepage, sanitised (no scripts, no forms, no trackers). */
  shell: z.object({
    headerHtml: z.string(),
    footerHtml: z.string(),
    css: z.string(), // scoped CSS needed to render the shell (fonts, colours, layout)
    navLinks: z.array(z.object({ label: z.string(), href: z.string() })),
    screenshotKey: z.string().nullable(),
  }),
  services: z.array(z.object({ key: z.string(), label: z.string(), url: z.string().nullable() })),
  areas: z.array(z.object({ name: z.string(), outward: z.string().nullable() })),
  cta: z.object({ text: z.string(), url: z.string() }),
  badges: z.array(BadgeSchema),
  reviews: z.object({
    sources: z.array(ReviewSourceSchema),
    featured: z.array(PublicReviewSchema), // best public reviews to show (attributed, linked)
    aggregate: z.object({ rating: z.number().nullable(), count: z.number().int() }), // weighted across matched sources
  }),
  projects: z.array(ScrapedProjectSchema),
  social: z.array(z.object({ network: z.string(), url: z.string() })),
  /** Things the owner must confirm or that looked wrong (e.g. a same-name business in another town). */
  warnings: z.array(z.string()),
  /** Candidates that were rejected by entity matching, kept for transparency. */
  rejected: z.array(z.object({ url: z.string(), reason: z.string() })),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;
