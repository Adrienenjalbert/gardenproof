/**
 * Pure mappers: approved ad copy + rendered videos → import-ready CSVs.
 *
 * - Google Ads Editor, Performance Max asset groups (one wide row per asset group).
 * - Meta Ads Manager bulk sheet (one row per video × copy variant).
 *
 * Length rules: Google limits are hard (Editor rejects the row), so over-long items are dropped — never
 * truncated mid-word — with a warning. Meta limits are display recommendations, so items are kept and warned.
 * Every destination URL carries utm_content=asset_<id> so /api/leads can attribute enquiries to the creative.
 */
import type { AdCopyContent, VideoAssetContent } from "@/lib/domain";
import type { CsvValue } from "./csv";

export const GOOGLE_LIMITS = {
  headline: { maxChars: 30, maxCount: 15, minCount: 3 },
  longHeadline: { maxChars: 90, maxCount: 5, minCount: 1 },
  description: { maxChars: 90, maxCount: 5, minCount: 2 },
  /** Google requires at least one description of 60 characters or fewer. */
  shortDescriptionChars: 60,
  businessName: { maxChars: 25 },
} as const;

export const META_LIMITS = {
  primaryText: { recommendedChars: 125 },
  headline: { recommendedChars: 40, maxChars: 255 },
  /** Copy variants per video; more rows than this just fragments delivery. */
  variantsPerVideo: 3,
} as const;

export type AdCopyInput = { assetId: string; content: AdCopyContent };
export type VideoInput = { assetId: string; fileName: string | null; content: VideoAssetContent };
export type AdBundleContext = {
  jobCode: string;
  area: string | null;
  serviceLabel: string;
  businessName: string;
  /** Landing page (published portfolio page, else the tenant's projects page). */
  finalUrl: string;
  /** utm_campaign value shared by both platforms, e.g. "gp_tl-5937". */
  utmCampaign: string;
};

export type ItemCheck = { kept: string[]; warnings: string[] };

/** Trim, de-duplicate (case-insensitive), drop items over `maxChars`, cap at `maxCount`. */
export function fitItems(items: string[], label: string, maxChars: number, maxCount: number): ItemCheck {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of items) {
    const item = raw.replace(/\s+/g, " ").trim();
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    if ([...item].length > maxChars) {
      warnings.push(`${label} dropped (${[...item].length}/${maxChars} chars): "${item}"`);
      continue;
    }
    if (kept.length >= maxCount) {
      warnings.push(`${label} dropped (max ${maxCount}): "${item}"`);
      continue;
    }
    kept.push(item);
  }
  return { kept, warnings };
}

export function withUtm(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

const numbered = (label: string, n: number) => Array.from({ length: n }, (_, i) => `${label} ${i + 1}`);
const padTo = (items: string[], n: number): CsvValue[] => [...items, ...Array<CsvValue>(n - items.length).fill("")];

export function buildGooglePmaxRows(ads: AdCopyInput[], ctx: AdBundleContext): { rows: CsvValue[][]; warnings: string[] } {
  const L = GOOGLE_LIMITS;
  const warnings: string[] = [];
  const header = [
    "Campaign",
    "Asset group",
    "Final URL",
    "Business name",
    ...numbered("Headline", L.headline.maxCount),
    ...numbered("Long headline", L.longHeadline.maxCount),
    ...numbered("Description", L.description.maxCount),
  ];
  let businessName = ctx.businessName.trim();
  if ([...businessName].length > L.businessName.maxChars) {
    warnings.push(`Business name over ${L.businessName.maxChars} chars — set it in Google Ads Editor.`);
    businessName = "";
  }
  const campaign = `${ctx.businessName} | PMax | ${ctx.serviceLabel}`;
  const rows = ads.map((ad) => {
    const group = `${ctx.jobCode}${ctx.area ? ` ${ctx.area}` : ""} | ${ad.content.angle}`;
    const h = fitItems(ad.content.pmax.headlines, "Headline", L.headline.maxChars, L.headline.maxCount);
    const lh = fitItems(ad.content.pmax.longHeadlines, "Long headline", L.longHeadline.maxChars, L.longHeadline.maxCount);
    const d = fitItems(ad.content.pmax.descriptions, "Description", L.description.maxChars, L.description.maxCount);
    const groupWarnings = [...h.warnings, ...lh.warnings, ...d.warnings];
    if (h.kept.length < L.headline.minCount) groupWarnings.push(`Needs at least ${L.headline.minCount} headlines.`);
    if (lh.kept.length < L.longHeadline.minCount) groupWarnings.push("Needs at least 1 long headline.");
    if (d.kept.length < L.description.minCount) groupWarnings.push(`Needs at least ${L.description.minCount} descriptions.`);
    if (!d.kept.some((x) => [...x].length <= L.shortDescriptionChars)) {
      groupWarnings.push(`Google requires one description of ${L.shortDescriptionChars} chars or fewer.`);
    }
    warnings.push(...groupWarnings.map((w) => `[${group}] ${w}`));
    const url = withUtm(ctx.finalUrl, {
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: ctx.utmCampaign,
      utm_content: `asset_${ad.assetId}`,
    });
    return [
      campaign,
      group,
      url,
      businessName,
      ...padTo(h.kept, L.headline.maxCount),
      ...padTo(lh.kept, L.longHeadline.maxCount),
      ...padTo(d.kept, L.description.maxCount),
    ];
  });
  return { rows: [header, ...rows], warnings };
}

export function buildMetaRows(
  ads: AdCopyInput[],
  videos: VideoInput[],
  ctx: AdBundleContext,
): { rows: CsvValue[][]; warnings: string[] } {
  const warnings: string[] = [];
  const header = [
    "Campaign Name",
    "Ad Set Name",
    "Ad Name",
    "Primary Text",
    "Headline",
    "Call to Action",
    "Website URL",
    "URL Tags",
    "Video File Name",
    "On-video Hook",
  ];
  const rows: CsvValue[][] = [];
  const campaign = `${ctx.businessName} | ${ctx.serviceLabel}`;
  const adSet = `${ctx.area ?? "SW London"} | ${ctx.jobCode}`;
  for (const ad of ads) {
    const texts = ad.content.meta.primaryTexts.map((t) => t.trim()).filter(Boolean);
    const heads = fitItems(ad.content.meta.headlines, "Meta headline", META_LIMITS.headline.maxChars, 50);
    warnings.push(...heads.warnings);
    for (const t of texts) {
      if (t.length > META_LIMITS.primaryText.recommendedChars) {
        warnings.push(`Meta primary text over ${META_LIMITS.primaryText.recommendedChars} chars (truncated in feed): "${t.slice(0, 40)}…"`);
      }
    }
    for (const hl of heads.kept) {
      if (hl.length > META_LIMITS.headline.recommendedChars) {
        warnings.push(`Meta headline over ${META_LIMITS.headline.recommendedChars} chars (truncated on mobile): "${hl}"`);
      }
    }
    if (!texts.length || !heads.kept.length) {
      warnings.push(`Ad copy ${ad.assetId} has no usable Meta text.`);
      continue;
    }
    const variants = Math.min(Math.max(texts.length, heads.kept.length), META_LIMITS.variantsPerVideo);
    const creatives: (VideoInput | null)[] = videos.length ? videos : [null];
    if (!videos.length) warnings.push("No rendered videos yet — Meta rows have no creative file.");
    for (const video of creatives) {
      for (let v = 0; v < variants; v++) {
        const creativeId = video?.assetId ?? ad.assetId;
        const label = video ? `${video.content.template} ${video.content.ratio}` : ad.content.angle;
        rows.push([
          campaign,
          adSet,
          `${ctx.jobCode} | ${label} | v${v + 1}`,
          texts[v % texts.length],
          heads.kept[v % heads.kept.length],
          "LEARN_MORE",
          ctx.finalUrl,
          new URLSearchParams({
            utm_source: "facebook",
            utm_medium: "paid_social",
            utm_campaign: ctx.utmCampaign,
            utm_content: `asset_${creativeId}`,
          }).toString(),
          video?.fileName ?? "",
          video?.content.hook ?? "",
        ]);
      }
    }
  }
  return { rows: [header, ...rows], warnings: [...new Set(warnings)] };
}
