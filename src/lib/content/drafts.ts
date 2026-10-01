/**
 * Model-facing output schemas ("drafts"). The copywriter (real or mock) only writes words;
 * code then assembles the final ASSET_CONTENT_SCHEMAS object and injects everything that must
 * be exact — media ids, testimonial text, CTA, facts — so consent and ids can never drift.
 */
import { z } from "zod";
import { AdCopyContentSchema, FaqSchema, JobEnrichmentSchema } from "@/lib/domain";

export const PortfolioDraftSchema = z.object({
  slug: z.string().describe("lowercase-hyphenated: main feature + area + year"),
  seoTitle: z.string().max(65),
  metaDescription: z.string().max(160),
  h1: z.string().max(90),
  summary: z.string().describe("2-3 factual sentences"),
  sections: z.object({ brief: z.string(), challenge: z.string(), solution: z.string(), result: z.string() }),
  faqs: z.array(FaqSchema).max(4),
  gallery: z.array(z.object({ mediaId: z.string(), alt: z.string(), caption: z.string().optional() })),
});
export type PortfolioDraft = z.infer<typeof PortfolioDraftSchema>;

/** Ad copy is all words, so the draft is the contract itself (length limits included). */
export const AdDraftSchema = AdCopyContentSchema;
export type AdDraft = z.infer<typeof AdDraftSchema>;

export const SocialDraftSchema = z.object({
  captions: z.array(z.string().max(2200)).min(2).max(3),
  hashtags: z.array(z.string()).max(12),
  reelCoverText: z.string().max(40).nullable(),
});
export type SocialDraft = z.infer<typeof SocialDraftSchema>;

export const GbpDraftSchema = z.object({ text: z.string().max(1500) });
export type GbpDraft = z.infer<typeof GbpDraftSchema>;

export const SeoDraftSchema = z.object({
  seoTitle: z.string().max(65),
  metaDescription: z.string().max(160),
  h1: z.string(),
  targetKeyword: z.string(),
  bodyMarkdown: z.string(),
  faqs: z.array(FaqSchema).max(5),
});
export type SeoDraft = z.infer<typeof SeoDraftSchema>;

export const ImageAssessmentSchema = z.object({
  mediaId: z.string(),
  qualityScore: z.number().min(0).max(1),
  notes: z.array(z.string()).default([]),
  peopleVisible: z.boolean().default(false),
  facesVisible: z.boolean().default(false),
  numberPlatesVisible: z.boolean().default(false),
  houseNumberVisible: z.boolean().default(false),
});
export type ImageAssessment = z.infer<typeof ImageAssessmentSchema>;

export const EnrichmentDraftSchema = JobEnrichmentSchema.extend({ images: z.array(ImageAssessmentSchema).default([]) });
export type EnrichmentDraft = z.infer<typeof EnrichmentDraftSchema>;

export const JudgeSchema = z.object({ premium: z.number().int().min(1).max(5), reason: z.string() });
export type JudgeResult = z.infer<typeof JudgeSchema>;
