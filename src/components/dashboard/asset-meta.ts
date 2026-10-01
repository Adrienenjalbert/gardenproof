import type { AssetType } from "@/lib/domain";
import type { IconName } from "@/components/ui/icons";

export const ASSET_TYPE_META: Record<AssetType, { label: string; icon: IconName; short: string }> = {
  portfolio_page: { label: "Portfolio page", icon: "doc", short: "Page" },
  seo_article: { label: "SEO article", icon: "layers", short: "Article" },
  ad_copy: { label: "Ad copy", icon: "megaphone", short: "Ads" },
  social_pack: { label: "Social pack", icon: "grid", short: "Social" },
  gbp_post: { label: "Google Business post", icon: "store", short: "GBP" },
  video: { label: "Video", icon: "film", short: "Video" },
};
