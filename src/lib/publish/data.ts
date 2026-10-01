/**
 * DB-backed loaders that turn asset rows into render models. Used by the preview page, the portfolio grid,
 * the public JSON feed and the publisher, so all of them apply the same public-safety rules.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset, Tenant } from "@/db/schema";
import { env } from "@/lib/config";
import { ASSET_STATUSES, PortfolioPageContentSchema, SeoArticleContentSchema, type AssetStatus } from "@/lib/domain";
import { publishableImageKey } from "@/lib/privacy";
import { publicUrl } from "@/lib/storage";
import { getTenant } from "@/lib/tenants";
import { applyConsent, loadPublicConsent, NO_CONSENT } from "./consent";
import {
  buildArticleView,
  buildPortfolioView,
  projectUrl,
  type ArticleView,
  type MediaInput,
  type PortfolioView,
} from "./view";

export async function loadAsset(assetId: string): Promise<Asset | null> {
  const db = await getDb();
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId));
  return asset ?? null;
}

/**
 * Media rows of the given jobs with `publicKey` replaced by the ONLY key that may appear publicly
 * (`publishableImageKey`): never the original, and nothing for a "needs blur" photo until it is blurred or
 * cleared by the operator. Non-images always come back with publicKey null.
 */
export async function mediaForJobs(jobIds: string[]): Promise<(MediaInput & { jobId: string })[]> {
  if (!jobIds.length) return [];
  const db = await getDb();
  const rows = await db.select().from(schema.media).where(inArray(schema.media.jobId, jobIds));
  return rows.map((m) => ({
    id: m.id,
    jobId: m.jobId,
    stage: m.stage,
    kind: m.kind,
    publicKey: publishableImageKey(m),
    width: m.width,
    height: m.height,
  }));
}

const liveUrl = (asset: Asset) => (asset.status === "published" ? asset.externalUrl : null);

/** Absolute media URLs are needed off-site (WordPress, JSON feed); previews use same-origin paths. */
export type UrlMode = "relative" | "absolute";

export async function portfolioViewFor(asset: Asset, tenant: Tenant, mode: UrlMode = "relative"): Promise<PortfolioView> {
  return (await portfolioModelFor(asset, tenant, mode)).view;
}

/** The consent-gated view plus the consent it was gated with (withdrawn jobs must not be shown at all). */
async function portfolioModelFor(asset: Asset, tenant: Tenant, mode: UrlMode) {
  const content = PortfolioPageContentSchema.parse(asset.content);
  const media = asset.jobId ? await mediaForJobs([asset.jobId]) : [];
  const consent = (asset.jobId && (await loadPublicConsent([asset.jobId])).get(asset.jobId)) || NO_CONSENT;
  const view = buildPortfolioView(content, media, {
    assetId: asset.id,
    config: tenant.config,
    appUrl: env.appUrl,
    mediaUrl: (key) => publicUrl(key, mode === "absolute"),
    canonicalUrl: liveUrl(asset),
    publishedAt: asset.publishedAt,
  });
  return { view: applyConsent(view, consent), consent };
}

/** Links to the live (or, failing that, canonical) pages of the article's related projects. */
async function relatedProjects(jobIds: string[], tenant: Tenant) {
  if (!jobIds.length) return [];
  const db = await getDb();
  const pages = await db
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.tenantId, tenant.id),
        eq(schema.assets.type, "portfolio_page"),
        eq(schema.assets.status, "published"),
        inArray(schema.assets.jobId, jobIds),
      ),
    );
  return pages.flatMap((page) => {
    const parsed = PortfolioPageContentSchema.safeParse(page.content);
    if (!parsed.success) return [];
    return [{ title: parsed.data.h1, url: page.externalUrl ?? projectUrl(tenant.config, parsed.data.slug) }];
  });
}

export async function articleViewFor(asset: Asset, tenant: Tenant): Promise<ArticleView> {
  const content = SeoArticleContentSchema.parse(asset.content);
  return buildArticleView(content, await relatedProjects(content.relatedJobIds, tenant), {
    assetId: asset.id,
    config: tenant.config,
    appUrl: env.appUrl,
    mediaUrl: (key) => publicUrl(key, true),
    canonicalUrl: liveUrl(asset),
    publishedAt: asset.publishedAt,
  });
}

type PreviewBase = { asset: Asset; tenant: Tenant; /** Publicly visible (published, consent not withdrawn). */ isPublic: boolean };
export type PreviewModel = PreviewBase & ({ view: PortfolioView } | { view: ArticleView });

/**
 * Any portfolio page / article, whatever its status. Callers must show non-public models (`isPublic` false:
 * drafts, or a job whose homeowner withdrew consent) to the signed-in operator only.
 */
export async function loadPreview(assetId: string): Promise<PreviewModel | null> {
  const asset = await loadAsset(assetId);
  if (!asset || (asset.type !== "portfolio_page" && asset.type !== "seo_article")) return null;
  const tenant = await getTenant(asset.tenantId);
  const published = asset.status === "published";
  try {
    if (asset.type === "portfolio_page") {
      const { view, consent } = await portfolioModelFor(asset, tenant, "relative");
      return { asset, tenant, view, isPublic: published && !consent.withdrawn };
    }
    return { asset, tenant, view: await articleViewFor(asset, tenant), isPublic: published };
  } catch (err) {
    console.error(`[preview] asset ${assetId} content does not match its schema`, err);
    return null;
  }
}

export type ProjectCard = {
  assetId: string;
  slug: string;
  title: string;
  summary: string;
  service: string;
  area: string | null;
  image: PortfolioView["hero"];
  url: string;
  status: AssetStatus;
  rating: number | null;
  publishedAt: string | null;
};

export const PUBLIC_STATUSES: AssetStatus[] = ["published"];
/** Operator-only view (/portfolio?drafts=1 with a dashboard session). */
export const DEMO_DRAFT_STATUSES: AssetStatus[] = ["published", "approved", "in_review"];

export async function listProjectCards(
  tenant: Tenant,
  { statuses = PUBLIC_STATUSES, mode = "relative" }: { statuses?: AssetStatus[]; mode?: UrlMode } = {},
): Promise<ProjectCard[]> {
  const db = await getDb();
  const valid = statuses.filter((s) => (ASSET_STATUSES as readonly string[]).includes(s));
  const rows = await db
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.tenantId, tenant.id),
        eq(schema.assets.type, "portfolio_page"),
        inArray(schema.assets.status, valid),
      ),
    )
    .orderBy(desc(schema.assets.publishedAt), desc(schema.assets.updatedAt));
  const jobIds = [...new Set(rows.map((r) => r.jobId).filter((j): j is string => !!j))];
  const media = await mediaForJobs(jobIds);
  const consents = await loadPublicConsent(jobIds);

  return rows.flatMap((asset) => {
    const parsed = PortfolioPageContentSchema.safeParse(asset.content);
    const consent = (asset.jobId && consents.get(asset.jobId)) || NO_CONSENT;
    if (!parsed.success || consent.withdrawn) return [];
    const built = buildPortfolioView(
      parsed.data,
      media.filter((m) => m.jobId === asset.jobId),
      {
        assetId: asset.id,
        config: tenant.config,
        appUrl: env.appUrl,
        mediaUrl: (key) => publicUrl(key, mode === "absolute"),
        canonicalUrl: liveUrl(asset),
        publishedAt: asset.publishedAt,
      },
    );
    const view = applyConsent(built, consent);
    // Local-mode publishing sets externalUrl to the relative preview path.
    const url = liveUrl(asset) ?? `/preview/${asset.id}`;
    return [
      {
        assetId: asset.id,
        slug: view.slug,
        title: view.h1,
        summary: view.summary,
        service: view.facts.service,
        area: view.facts.area,
        image: view.hero,
        url: mode === "absolute" && url.startsWith("/") ? new URL(url, env.appUrl).toString() : url,
        status: asset.status,
        rating: view.testimonial?.rating ?? null,
        publishedAt: view.publishedAt,
      },
    ];
  });
}
