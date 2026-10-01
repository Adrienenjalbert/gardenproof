/** AI task names and the structured data each one is given (the mock reads `data` directly). */
import type { MediaStage } from "@/lib/domain";
import type { ContentContext, SeoContext } from "@/lib/content/types";
import type { ImageMetrics } from "./images";

export type EnrichmentTaskData = {
  crewNotes: string;
  jobService: string | null;
  serviceKeys: string[];
  images: { mediaId: string; stage: MediaStage; metrics: ImageMetrics | null }[];
};

export type AiTaskData = {
  enrichment: EnrichmentTaskData;
  portfolio_page: ContentContext;
  ad_copy: ContentContext;
  social_pack: ContentContext;
  gbp_post: ContentContext;
  seo_article: SeoContext;
  judge: { assetType: string; content: unknown; voice: string };
};

export type AiTask = keyof AiTaskData;
