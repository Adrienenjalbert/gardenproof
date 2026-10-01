/**
 * Shared domain contracts for GardenProof.
 * Every module (bot, content engine, video, publisher, dashboard) builds on these types.
 * Change with care: they are the seams between modules.
 */
import { z } from "zod";

export const TEAMS = ["landscaping", "maintenance"] as const;
export type Team = (typeof TEAMS)[number];

export const CREW_ROLES = ["crew", "foreman", "owner", "admin"] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

export const MEDIA_STAGES = ["before", "progress", "after"] as const;
export type MediaStage = (typeof MEDIA_STAGES)[number];

export const MEDIA_KINDS = ["image", "video", "audio"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Job lifecycle for Phase 1 (content engine). */
export const JOB_STATUSES = [
  "capturing", // crew has opened the job and is sending before/progress media
  "captured", // crew tapped Done; after photos received
  "awaiting_testimonial", // homeowner request sent
  "ready_for_content", // testimonial received or timed out
  "content_draft", // assets generated, not yet reviewed
  "in_review", // at least one asset waiting for agency approval
  "published", // at least one asset published
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ASSET_TYPES = [
  "portfolio_page",
  "seo_article",
  "ad_copy",
  "social_pack",
  "gbp_post",
  "video",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_STATUSES = ["draft", "in_review", "approved", "rejected", "published"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const VIDEO_TEMPLATES = ["reveal", "proof", "process"] as const;
export type VideoTemplate = (typeof VIDEO_TEMPLATES)[number];

export const VIDEO_RATIOS = ["9:16", "1:1", "16:9"] as const;
export type VideoRatio = (typeof VIDEO_RATIOS)[number];

export const MESSAGE_STATUSES = ["queued", "held", "approved", "sent", "failed", "cancelled"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Enrichment output (AI reads photos + voice notes, returns structured facts)
// ---------------------------------------------------------------------------
export const JobEnrichmentSchema = z.object({
  service: z.string(), // tenant service key, e.g. "patio_paving"
  subServices: z.array(z.string()).default([]),
  features: z.array(z.string()).default([]), // "circular brick pond", "pleached hornbeam"
  materials: z.array(z.string()).default([]), // "Indian sandstone", "porcelain"
  plants: z.array(z.string()).default([]),
  durationDays: z.number().int().positive().nullable().default(null),
  challenge: z.string().nullable().default(null), // what was hard / the brief
  result: z.string().nullable().default(null), // the transformation in one sentence
  style: z.string().nullable().default(null), // "contemporary", "cottage", "formal"
  heroBeforeMediaId: z.string().nullable().default(null),
  heroAfterMediaId: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type JobEnrichment = z.infer<typeof JobEnrichmentSchema>;

// ---------------------------------------------------------------------------
// Asset content contracts (assets.content jsonb is one of these, keyed by type)
// ---------------------------------------------------------------------------
export const FaqSchema = z.object({ q: z.string(), a: z.string() });

export const PortfolioPageContentSchema = z.object({
  slug: z.string(), // e.g. "circular-pond-gravel-garden-wimbledon-2026"
  seoTitle: z.string().max(65),
  metaDescription: z.string().max(160),
  h1: z.string(),
  summary: z.string(), // 2-3 factual sentences, quotable by AI answer engines
  sections: z.object({
    brief: z.string(),
    challenge: z.string(),
    solution: z.string(),
    result: z.string(),
  }),
  facts: z.object({
    service: z.string(),
    area: z.string().nullable(),
    materials: z.array(z.string()),
    features: z.array(z.string()),
    duration: z.string().nullable(),
  }),
  testimonial: z
    .object({ quote: z.string(), attribution: z.string(), rating: z.number().int().min(1).max(5) })
    .nullable(),
  gallery: z.array(
    z.object({ mediaId: z.string(), stage: z.enum(MEDIA_STAGES), alt: z.string(), caption: z.string().optional() }),
  ),
  beforeAfter: z.object({ beforeMediaId: z.string(), afterMediaId: z.string() }).nullable(),
  faqs: z.array(FaqSchema).default([]),
  cta: z.object({ text: z.string(), url: z.string() }),
  internalLinks: z.array(z.object({ text: z.string(), url: z.string() })).default([]),
});
export type PortfolioPageContent = z.infer<typeof PortfolioPageContentSchema>;

export const SeoArticleContentSchema = z.object({
  slug: z.string(),
  seoTitle: z.string().max(65),
  metaDescription: z.string().max(160),
  h1: z.string(),
  targetKeyword: z.string(),
  bodyMarkdown: z.string(),
  relatedJobIds: z.array(z.string()),
  faqs: z.array(FaqSchema).default([]),
});
export type SeoArticleContent = z.infer<typeof SeoArticleContentSchema>;

export const AdCopyContentSchema = z.object({
  // Meta (Facebook / Instagram)
  meta: z.object({
    hooks: z.array(z.string()).min(3), // on-video hook text, <= 6 words each
    primaryTexts: z.array(z.string()).min(3), // <= 125 chars recommended
    headlines: z.array(z.string()).min(3), // <= 40 chars
  }),
  // Google Performance Max asset group
  pmax: z.object({
    headlines: z.array(z.string().max(30)).min(3),
    longHeadlines: z.array(z.string().max(90)).min(1),
    descriptions: z.array(z.string().max(90)).min(2),
  }),
  angle: z.string(), // e.g. "transformation", "proof", "craft"
});
export type AdCopyContent = z.infer<typeof AdCopyContentSchema>;

export const SocialPackContentSchema = z.object({
  carouselOrder: z.array(z.string()), // media ids in order
  captions: z.array(z.string()).min(1), // variants for Instagram / Facebook
  hashtags: z.array(z.string()),
  reelCoverText: z.string().nullable().default(null),
});
export type SocialPackContent = z.infer<typeof SocialPackContentSchema>;

export const GbpPostContentSchema = z.object({
  text: z.string().max(1500),
  mediaId: z.string().nullable(),
  ctaType: z.enum(["BOOK", "LEARN_MORE", "CALL"]),
  ctaUrl: z.string().nullable(),
});
export type GbpPostContent = z.infer<typeof GbpPostContentSchema>;

export const VideoAssetContentSchema = z.object({
  template: z.enum(VIDEO_TEMPLATES),
  ratio: z.enum(VIDEO_RATIOS),
  hook: z.string(),
  props: z.record(z.string(), z.unknown()), // exact props passed to the Remotion composition
  durationSec: z.number().nullable().default(null),
});
export type VideoAssetContent = z.infer<typeof VideoAssetContentSchema>;

export const ASSET_CONTENT_SCHEMAS = {
  portfolio_page: PortfolioPageContentSchema,
  seo_article: SeoArticleContentSchema,
  ad_copy: AdCopyContentSchema,
  social_pack: SocialPackContentSchema,
  gbp_post: GbpPostContentSchema,
  video: VideoAssetContentSchema,
} as const satisfies Record<AssetType, z.ZodTypeAny>;

export type AssetContentByType = {
  portfolio_page: PortfolioPageContent;
  seo_article: SeoArticleContent;
  ad_copy: AdCopyContent;
  social_pack: SocialPackContent;
  gbp_post: GbpPostContent;
  video: VideoAssetContent;
};
