/**
 * Asset writers: ContentContext -> validated asset content + checks. No DB access, so the
 * eval harness and tests run the exact code path production uses.
 *
 * Each writer asks the copywriter (model or mock) for a *draft* (words only), then assembles
 * the contract object and injects the exact parts in code: media ids, testimonial, CTA, facts.
 */
import { generate, type GenerateResult } from "@/lib/ai/client";
import { DEMO_CHECK } from "@/lib/ai/mock";
import { galleryOrder, mockPortfolio } from "@/lib/ai/mock-copy";
import {
  ASSET_CONTENT_SCHEMAS,
  type AdCopyContent,
  type AssetContentByType,
  type GbpPostContent,
  type PortfolioPageContent,
  type SeoArticleContent,
  type SocialPackContent,
} from "@/lib/domain";
import { lintContextFor } from "./context";
import type { ConsentDecision } from "./consent";
import { AdDraftSchema, GbpDraftSchema, PortfolioDraftSchema, SeoDraftSchema, SocialDraftSchema } from "./drafts";
import { lintAsset } from "./lint";
import { cap, slugify } from "./text";
import type { Check, ContentContext, LintContext, SeoContext } from "./types";

export const JOB_ASSET_TYPES = ["portfolio_page", "ad_copy", "social_pack", "gbp_post"] as const;
export type JobAssetType = (typeof JOB_ASSET_TYPES)[number];

export type Written<T> = { content: T; checks: Check[]; title: string };

/** What the model sees: the context minus internal bookkeeping. */
function promptVars(ctx: ContentContext): Record<string, string> {
  const { notes: _notes, media, ...rest } = ctx;
  void _notes;
  return {
    context: JSON.stringify({ ...rest, media: media.map((m) => ({ id: m.id, stage: m.stage, isHero: m.isHero })) }, null, 2),
    mediaList: media.map((m) => `- ${m.id} (${m.stage})`).join("\n") || "- none",
    area: ctx.area.name,
    areaRule: ctx.area.named
      ? `You may name the area "${ctx.area.name}"${ctx.area.outwardCode ? ` and the postcode district ${ctx.area.outwardCode}` : ""}. Never a street or house number.`
      : `The homeowner has NOT consented to naming their area: say "${ctx.area.name}" only. Never a neighbourhood, street, postcode or house number.`,
    testimonialRule: ctx.testimonial
      ? `You may quote the testimonial word for word and in full, attributed to "${ctx.testimonial.attribution}", rating ${ctx.testimonial.rating}/5. Never shorten, trim or edit it: if the whole quote does not fit a field's limit, leave it out of that field.`
      : "There is NO usable testimonial: do not quote, paraphrase or imply a customer review, rating or star count.",
    inputRule: ctx.notes.some((n) => n.id === "thin-input")
      ? "The crew notes are thin. Write short, plain copy from the service, area and photos only. Do not pad it with general statements about craft or materials."
      : "Use the crew's own details. Do not add general statements about craft or workmanship that the notes do not make.",
    instructions: ctx.instructions ?? "None.",
    bannedPhrases: ctx.tenant.dontSay.map((p) => `"${p}"`).join(", "),
    tenantName: ctx.tenant.name,
    ctaText: ctx.tenant.cta.text,
  };
}

function generatorChecks(res: GenerateResult<unknown>, instructions: string | null): Check[] {
  const checks: Check[] = [
    res.provider === "mock"
      ? { ...DEMO_CHECK }
      : { id: "generator", ok: true, message: `${res.model} · prompt ${res.prompt} v${res.promptVersion} · ${res.attempts} attempt(s)` },
  ];
  if (instructions && res.provider === "mock") {
    checks.push({ id: "instructions", ok: true, message: "Reviewer note saved, but demo mode cannot apply free-text notes. Add an API key to regenerate with it." });
  }
  return checks;
}

function finish<T>(type: keyof AssetContentByType, content: T, lintCtx: LintContext, extra: Check[]): Check[] {
  const parsed = ASSET_CONTENT_SCHEMAS[type].safeParse(content);
  if (!parsed.success) throw new Error(`Assembled ${type} does not match its contract: ${parsed.error.message}`);
  return [...extra, ...lintAsset(type, parsed.data, lintCtx)];
}

// ---------------------------------------------------------------------------
export async function writePortfolioPage(ctx: ContentContext, consent: Pick<ConsentDecision, "forbidden">): Promise<Written<PortfolioPageContent>> {
  const res = await generate("portfolio_page", PortfolioDraftSchema, { prompt: "portfolio_page", vars: promptVars(ctx), data: ctx, maxTokens: 4096 });
  const d = res.data;
  const drafted = new Map(d.gallery.map((g) => [g.mediaId, g]));
  const fallback = new Map(mockPortfolio(ctx).gallery.map((g) => [g.mediaId, g]));
  const content: PortfolioPageContent = {
    slug: slugify(d.slug) || slugify(d.h1),
    seoTitle: d.seoTitle,
    metaDescription: d.metaDescription,
    h1: d.h1,
    summary: d.summary,
    sections: d.sections,
    facts: {
      service: ctx.job.serviceLabel,
      area: ctx.area.named ? ctx.area.name : null,
      materials: ctx.facts.materials,
      features: ctx.facts.features,
      duration: ctx.facts.durationText ? cap(ctx.facts.durationText) : null,
    },
    testimonial: ctx.testimonial ? { ...ctx.testimonial } : null,
    gallery: galleryOrder(ctx).map((m) => {
      const g = drafted.get(m.id)?.alt?.trim() ? drafted.get(m.id)! : fallback.get(m.id)!;
      return { mediaId: m.id, stage: m.stage, alt: g.alt.trim(), ...(g.caption ? { caption: g.caption } : {}) };
    }),
    beforeAfter: ctx.heroBeforeId && ctx.heroAfterId ? { beforeMediaId: ctx.heroBeforeId, afterMediaId: ctx.heroAfterId } : null,
    faqs: d.faqs,
    cta: { ...ctx.tenant.cta },
    internalLinks: [{ text: "More finished gardens", url: ctx.tenant.projectsUrl }],
  };
  const lintCtx = lintContextFor(ctx, consent);
  return { content, title: `Portfolio page — ${content.h1}`, checks: finish("portfolio_page", content, lintCtx, [...generatorChecks(res, ctx.instructions), ...ctx.notes]) };
}

export async function writeAdCopy(ctx: ContentContext, consent: Pick<ConsentDecision, "forbidden">): Promise<Written<AdCopyContent>> {
  const res = await generate("ad_copy", AdDraftSchema, { prompt: "ad_copy", vars: promptVars(ctx), data: ctx });
  const content: AdCopyContent = res.data;
  const lintCtx = lintContextFor(ctx, consent);
  return { content, title: `Ad copy — ${ctx.job.serviceLabel}, ${ctx.area.name}`, checks: finish("ad_copy", content, lintCtx, [...generatorChecks(res, ctx.instructions), ...ctx.notes]) };
}

/** Instagram carousel order: the reveal (before first), then the finished views, then progress. */
function carouselOrder(ctx: ContentContext): string[] {
  const rank = (m: ContentContext["media"][number]) =>
    m.id === ctx.heroBeforeId ? 0 : m.id === ctx.heroAfterId ? 1 : m.stage === "after" ? 2 : m.stage === "progress" ? 3 : 4;
  return [...ctx.media].sort((a, b) => rank(a) - rank(b)).map((m) => m.id).slice(0, 10);
}

export async function writeSocialPack(ctx: ContentContext, consent: Pick<ConsentDecision, "forbidden">): Promise<Written<SocialPackContent>> {
  const res = await generate("social_pack", SocialDraftSchema, { prompt: "social_pack", vars: promptVars(ctx), data: ctx });
  const content: SocialPackContent = {
    carouselOrder: carouselOrder(ctx),
    captions: res.data.captions,
    hashtags: [...new Set(res.data.hashtags.map((h) => `#${h.replace(/^#+/, "").replace(/[^A-Za-z0-9]/g, "")}`).filter((h) => h.length > 1))],
    reelCoverText: res.data.reelCoverText,
  };
  const lintCtx = lintContextFor(ctx, consent);
  return { content, title: `Social pack — ${ctx.job.serviceLabel}, ${ctx.area.name}`, checks: finish("social_pack", content, lintCtx, [...generatorChecks(res, ctx.instructions), ...ctx.notes]) };
}

export async function writeGbpPost(ctx: ContentContext, consent: Pick<ConsentDecision, "forbidden">): Promise<Written<GbpPostContent>> {
  const res = await generate("gbp_post", GbpDraftSchema, { prompt: "gbp_post", vars: promptVars(ctx), data: ctx });
  const content: GbpPostContent = {
    text: res.data.text,
    mediaId: ctx.heroAfterId ?? ctx.media.find((m) => m.stage === "after")?.id ?? null,
    ctaType: "BOOK",
    ctaUrl: ctx.tenant.cta.url,
  };
  const lintCtx = lintContextFor(ctx, consent);
  return { content, title: `Google Business post — ${ctx.area.name}`, checks: finish("gbp_post", content, lintCtx, [...generatorChecks(res, ctx.instructions), ...ctx.notes]) };
}

export async function writeJobAsset(type: JobAssetType, ctx: ContentContext, consent: Pick<ConsentDecision, "forbidden">): Promise<Written<AssetContentByType[JobAssetType]>> {
  switch (type) {
    case "portfolio_page":
      return writePortfolioPage(ctx, consent);
    case "ad_copy":
      return writeAdCopy(ctx, consent);
    case "social_pack":
      return writeSocialPack(ctx, consent);
    case "gbp_post":
      return writeGbpPost(ctx, consent);
  }
}

// ---------------------------------------------------------------------------
export const seoSlug = (serviceLabel: string, area: string) => slugify(`${serviceLabel} ${area}`);

export async function writeSeoArticle(ctx: SeoContext): Promise<Written<SeoArticleContent>> {
  const res = await generate("seo_article", SeoDraftSchema, {
    prompt: "seo_article",
    vars: {
      context: JSON.stringify(ctx, null, 2),
      area: ctx.area,
      serviceLabel: ctx.serviceLabel,
      instructions: ctx.instructions ?? "None.",
      bannedPhrases: ctx.tenant.dontSay.map((p) => `"${p}"`).join(", "),
      tenantName: ctx.tenant.name,
      ctaText: ctx.tenant.cta.text,
      ctaUrl: ctx.tenant.cta.url,
    },
    data: ctx,
    maxTokens: 6000,
  });
  const content: SeoArticleContent = {
    slug: seoSlug(ctx.serviceLabel, ctx.area),
    ...res.data,
    relatedJobIds: ctx.pages.map((p) => p.jobId),
  };
  return {
    content,
    title: `Area guide — ${ctx.serviceLabel} in ${ctx.area}`,
    checks: finish("seo_article", content, seoLintContext(ctx), generatorChecks(res, ctx.instructions)),
  };
}

/** Area articles may only restate facts from their (approved) cluster pages; never quote anyone. */
export function seoLintContext(ctx: SeoContext): LintContext {
  return {
    bannedPhrases: ctx.tenant.dontSay,
    mediaIds: [],
    sourceText: [
      ...ctx.pages.flatMap((p) => [p.h1, p.summary, p.duration ?? "", ...p.materials, ...p.features]),
      `${ctx.pages.length} projects`,
      ctx.tenant.whichRating ? `rated ${ctx.tenant.whichRating}` : "",
    ].join("\n"),
    rating: null,
    quote: null,
    ctaText: ctx.tenant.cta.text,
    whichRating: ctx.tenant.whichRating,
    areaNamed: true,
    outwardCode: null,
    forbidden: [],
    year: ctx.year,
  };
}
