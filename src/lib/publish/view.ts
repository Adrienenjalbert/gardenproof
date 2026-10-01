/**
 * Render models: asset content + media rows resolved into plain, serialisable objects.
 *
 * One model feeds every surface — the Next preview (React), the WordPress body fallback (HTML string), the
 * `gp_content` post meta the WP plugin template renders, JSON-LD and the public JSON feed — so the design
 * and the facts can never drift between them. `MediaInput.publicKey` must already be the result of
 * `publishableImageKey` (EXIF-stripped, blurred or cleared); the private original is never referenced.
 */
import type { MediaStage, PortfolioPageContent, SeoArticleContent } from "@/lib/domain";
import type { TenantConfig } from "@/lib/tenant";
import { renderMarkdown } from "./markdown";

export type MediaInput = {
  id: string;
  stage: MediaStage;
  kind: string;
  /** Publishable key (see publishableImageKey), or null when the image must not be shown. */
  publicKey: string | null;
  width: number | null;
  height: number | null;
};

/** A public image as it appears in every payload. Deliberately no storage key: only the URL leaves the app. */
export type PublicImage = {
  mediaId: string;
  src: string;
  alt: string;
  caption: string | null;
  stage: MediaStage;
  width: number | null;
  height: number | null;
  /** WordPress attachment id once uploaded. */
  wpId?: number;
};

export type BusinessRef = { name: string; url: string; logo: string | null; phone: string | null };

export type PortfolioView = {
  kind: "portfolio_page";
  assetId: string;
  slug: string;
  seoTitle: string;
  metaDescription: string;
  h1: string;
  summary: string;
  sections: PortfolioPageContent["sections"];
  facts: PortfolioPageContent["facts"];
  testimonial: PortfolioPageContent["testimonial"];
  faqs: PortfolioPageContent["faqs"];
  cta: PortfolioPageContent["cta"];
  internalLinks: PortfolioPageContent["internalLinks"];
  hero: PublicImage | null;
  beforeAfter: { before: PublicImage; after: PublicImage } | null;
  /** Images not already shown as hero or in the comparison. */
  gallery: PublicImage[];
  business: BusinessRef;
  canonicalUrl: string;
  publishedAt: string | null;
};

export type ArticleView = {
  kind: "seo_article";
  assetId: string;
  slug: string;
  seoTitle: string;
  metaDescription: string;
  h1: string;
  targetKeyword: string;
  bodyHtml: string;
  faqs: SeoArticleContent["faqs"];
  relatedProjects: { title: string; url: string }[];
  cta: { text: string; url: string };
  business: BusinessRef;
  canonicalUrl: string;
  publishedAt: string | null;
};

export type ViewContext = {
  assetId: string;
  config: TenantConfig;
  /** Absolute origin of the GardenProof app (for the logo and absolute media URLs). */
  appUrl: string;
  /** Maps a public storage key to a browser URL (relative for previews, absolute for WordPress/feeds). */
  mediaUrl: (key: string) => string;
  /** Live URL if already published (WordPress permalink); otherwise derived from the tenant site. */
  canonicalUrl?: string | null;
  publishedAt?: Date | null;
};

function siteUrl(config: TenantConfig, path: string): string {
  const base = config.wordpress?.baseUrl ?? config.website;
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

export function projectUrl(config: TenantConfig, slug: string): string {
  const path = (config.wordpress?.projectsPath ?? "/projects/").replace(/\/?$/, "/");
  return siteUrl(config, `${path}${encodeURIComponent(slug)}/`);
}

export function articleUrl(config: TenantConfig, slug: string): string {
  return siteUrl(config, `/advice/${encodeURIComponent(slug)}/`);
}

export function businessRef(config: TenantConfig, appUrl: string): BusinessRef {
  return {
    name: config.name,
    url: config.website,
    logo: config.brand.logoPath ? new URL(config.brand.logoPath, appUrl).toString() : null,
    phone: config.phone,
  };
}

const isAbsolute = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url);

export function buildPortfolioView(
  content: PortfolioPageContent,
  mediaRows: MediaInput[],
  ctx: ViewContext,
): PortfolioView {
  const byId = new Map(mediaRows.map((m) => [m.id, m]));
  const altFor = new Map(content.gallery.map((g) => [g.mediaId, g]));

  const image = (mediaId: string, fallbackAlt: string): PublicImage | null => {
    const row = byId.get(mediaId);
    if (!row || row.kind !== "image" || !row.publicKey) return null;
    const entry = altFor.get(mediaId);
    return {
      mediaId,
      src: ctx.mediaUrl(row.publicKey),
      alt: entry?.alt?.trim() || fallbackAlt,
      caption: entry?.caption ?? null,
      stage: row.stage,
      width: row.width,
      height: row.height,
    };
  };

  const before = content.beforeAfter ? image(content.beforeAfter.beforeMediaId, `Before: ${content.h1}`) : null;
  const after = content.beforeAfter ? image(content.beforeAfter.afterMediaId, `After: ${content.h1}`) : null;
  const galleryImages = content.gallery
    .map((g) => image(g.mediaId, content.h1))
    .filter((g): g is PublicImage => g !== null);

  const hero =
    after ?? galleryImages.find((g) => g.stage === "after") ?? galleryImages.find((g) => g.stage !== "before") ?? null;
  const shown = new Set([hero?.mediaId, before?.mediaId, after?.mediaId]);

  return {
    kind: "portfolio_page",
    assetId: ctx.assetId,
    slug: content.slug,
    seoTitle: content.seoTitle,
    metaDescription: content.metaDescription,
    h1: content.h1,
    summary: content.summary,
    sections: content.sections,
    facts: content.facts,
    testimonial: content.testimonial,
    faqs: content.faqs,
    cta: content.cta,
    internalLinks: content.internalLinks,
    hero,
    beforeAfter: before && after ? { before, after } : null,
    gallery: galleryImages.filter((g) => !shown.has(g.mediaId)),
    business: businessRef(ctx.config, ctx.appUrl),
    canonicalUrl: isAbsolute(ctx.canonicalUrl) ? ctx.canonicalUrl : projectUrl(ctx.config, content.slug),
    publishedAt: ctx.publishedAt ? ctx.publishedAt.toISOString() : null,
  };
}

export function buildArticleView(
  content: SeoArticleContent,
  relatedProjects: { title: string; url: string }[],
  ctx: ViewContext,
): ArticleView {
  return {
    kind: "seo_article",
    assetId: ctx.assetId,
    slug: content.slug,
    seoTitle: content.seoTitle,
    metaDescription: content.metaDescription,
    h1: content.h1,
    targetKeyword: content.targetKeyword,
    bodyHtml: renderMarkdown(content.bodyMarkdown),
    faqs: content.faqs,
    relatedProjects,
    cta: ctx.config.cta,
    business: businessRef(ctx.config, ctx.appUrl),
    canonicalUrl: isAbsolute(ctx.canonicalUrl) ? ctx.canonicalUrl : articleUrl(ctx.config, content.slug),
    publishedAt: ctx.publishedAt ? ctx.publishedAt.toISOString() : null,
  };
}
