/**
 * Content engine (module B): enrichment, asset generation, quality checks, regeneration.
 * Video assets are NOT created here — module C reads ad_copy.meta.hooks and renders them.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset } from "@/db/schema";
import type { PortfolioPageContent } from "@/lib/domain";
import { logEvent } from "@/lib/events";
import { jobAssetTypesFor, readOutputs } from "@/lib/outputs";
import { decideConsent } from "./consent";
import { buildContentContext, lintContextFor } from "./context";
import { ensureScreened } from "./enrich";
import { writeJobAsset, type JobAssetType } from "./generate";
import { lintAsset } from "./lint";
import { loadJobBundle } from "./load";
import { saveAssetVersion, uniqueSlug, type SaveResult } from "./persist";
import { clusterKeyForArticle, refreshSeoCluster, seoContextFor } from "./seo";
import { seoLintContext } from "./generate";
import type { Check } from "./types";

export { enrichJob, ensureScreened } from "./enrich";
export { refreshSeoCluster } from "./seo";
export { lintAsset, lintPassed } from "./lint";
export type { Check, LintContext } from "./types";

export type GenerateSummary = {
  jobId: string;
  skipped: null | "no_consent" | "no_public_media";
  assets: ({ type: JobAssetType | "seo_article" } & SaveResult)[];
};

export type GenerateOptions = {
  /** Subset of asset types to (re)generate. Default: what the business makes (see @/lib/outputs). */
  types?: readonly JobAssetType[];
  /** Reviewer note from "regenerate with note". */
  instructions?: string | null;
};

export async function generateContentForJob(jobId: string, opts: GenerateOptions = {}): Promise<GenerateSummary> {
  let bundle = await loadJobBundle(jobId);
  const { job, tenant } = bundle;
  const config = tenant.config;
  const consent = decideConsent({ job, customer: bundle.customer, testimonial: bundle.testimonial, config });

  if (!consent.publicAllowed) {
    const withdrawn = consent.refusal === "withdrawn";
    await logEvent({
      tenantId: job.tenantId,
      type: withdrawn ? "content.skipped_withdrawn" : "content.skipped_no_consent",
      entity: "job",
      entityId: jobId,
      data: { reason: withdrawn ? "homeowner withdrew consent" : "consentPhotos is false" },
    });
    return { jobId, skipped: "no_consent", assets: [] };
  }

  // Every image is privacy-screened before any copy can reference it.
  if (await ensureScreened(jobId)) bundle = await loadJobBundle(jobId);
  const ctx = buildContentContext({
    job: bundle.job,
    enrichment: bundle.job.enrichment,
    media: bundle.media,
    crewNotes: bundle.crewNotes,
    consent,
    config,
    instructions: opts.instructions,
  });
  if (!ctx.media.some((m) => m.stage === "after")) {
    await logEvent({ tenantId: job.tenantId, type: "content.skipped_no_media", entity: "job", entityId: jobId, data: { excluded: bundle.media.map((m) => m.id) } });
    return { jobId, skipped: "no_public_media", assets: [] };
  }

  const outputs = readOutputs(tenant.settings);
  const types = opts.types ?? jobAssetTypesFor(outputs);
  const summary: GenerateSummary = { jobId, skipped: null, assets: [] };
  for (const type of types) {
    const written = await writeJobAsset(type, ctx, consent);
    if (type === "portfolio_page") {
      const page = written.content as PortfolioPageContent;
      page.slug = await uniqueSlug(job.tenantId, jobId, page.slug, job.code);
    }
    const saved = await saveAssetVersion({
      tenantId: job.tenantId,
      jobId,
      type,
      title: written.title,
      content: written.content as unknown as Record<string, unknown>,
      checks: written.checks,
    });
    summary.assets.push({ type, ...saved });
  }

  const touchedPortfolio = types.includes("portfolio_page");
  if (outputs.areaArticles && touchedPortfolio && ctx.area.named && job.service) {
    const seo = await refreshSeoCluster({ tenantId: job.tenantId, service: job.service, area: ctx.area.name }, config);
    if (seo) summary.assets.push({ type: "seo_article", ...seo });
  }

  await settleJobStatus(jobId);
  await logEvent({
    tenantId: job.tenantId,
    type: "content.generated",
    entity: "job",
    entityId: jobId,
    data: { assets: summary.assets, instructions: opts.instructions ?? null, photoConsent: consent.photoConsent },
  });
  return summary;
}

/**
 * After (re)generation the job is "in_review", unless something of it is already live: a job with a
 * published asset stays "published" (the pipeline may have set ready_for_content just before).
 */
async function settleJobStatus(jobId: string): Promise<void> {
  const db = await getDb();
  const [current] = await db.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, jobId));
  const [live] = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(and(eq(schema.assets.jobId, jobId), eq(schema.assets.status, "published")))
    .limit(1);
  const status = current?.status === "published" || live ? "published" : "in_review";
  if (current?.status !== status) {
    await db.update(schema.jobs).set({ status, updatedAt: new Date() }).where(eq(schema.jobs.id, jobId));
  }
}

async function getAsset(assetId: string): Promise<Asset> {
  const db = await getDb();
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId));
  if (!asset) throw new Error(`Asset ${assetId} not found`);
  return asset;
}

/**
 * Publisher hook: call after a portfolio page is approved or published. Area articles are built only
 * from signed-off pages, so this is the moment a cluster can reach 2 pages (or change).
 */
export async function refreshSeoForPortfolioPage(assetId: string): Promise<SaveResult | null> {
  const asset = await getAsset(assetId);
  if (asset.type !== "portfolio_page" || !asset.jobId) return null;
  const area = (asset.content as unknown as PortfolioPageContent).facts?.area;
  const { job, tenant } = await loadJobBundle(asset.jobId);
  if (!area || !job.service) return null;
  return refreshSeoCluster({ tenantId: asset.tenantId, service: job.service, area }, tenant.config);
}

/**
 * Dashboard "regenerate with note". Approved/published versions are never overwritten:
 * a new in-review version is created instead (see persist.ts).
 */
export async function regenerateAsset(assetId: string, instructions?: string): Promise<SaveResult> {
  const asset = await getAsset(assetId);
  const note = instructions?.trim() || null;
  await logEvent({ tenantId: asset.tenantId, type: "asset.regenerate_requested", entity: "asset", entityId: assetId, actor: "agency", data: { instructions: note } });

  if (asset.type === "video") throw new Error("Video assets are regenerated by the video module (renderVideoAsset).");

  if (asset.type === "seo_article") {
    const { key, config } = await clusterKeyForArticle(asset);
    const saved = await refreshSeoCluster(key, config, note);
    if (!saved) throw new Error("This area no longer has enough approved projects for an article (minimum 2).");
    return saved;
  }

  if (!asset.jobId) throw new Error(`Asset ${assetId} has no job`);
  const summary = await generateContentForJob(asset.jobId, { types: [asset.type as JobAssetType], instructions: note });
  if (summary.skipped) throw new Error(`Regeneration skipped: ${summary.skipped === "no_consent" ? "the homeowner refused photo consent" : "no public-safe photos"}.`);
  const saved = summary.assets.find((a) => a.type === asset.type);
  if (!saved) throw new Error("Regeneration produced no asset");
  return saved;
}

/**
 * Re-run the deterministic checks after a manual edit in the dashboard (keeps generator and
 * consent notes, replaces lint results). Area articles are re-linted against their cluster.
 */
export async function recheckAsset(assetId: string): Promise<Check[]> {
  const asset = await getAsset(assetId);
  if (asset.type === "video") return (await import("@/lib/video")).recheckVideoAsset(assetId);
  let fresh: Check[];
  if (asset.type === "seo_article") {
    const { key, config } = await clusterKeyForArticle(asset);
    fresh = lintAsset(asset.type, asset.content, seoLintContext(await seoContextFor(key, config, null)));
  } else {
    if (!asset.jobId) return asset.checks;
    const bundle = await loadJobBundle(asset.jobId);
    const consent = decideConsent({ job: bundle.job, customer: bundle.customer, testimonial: bundle.testimonial, config: bundle.tenant.config });
    const ctx = buildContentContext({
      job: bundle.job,
      enrichment: bundle.job.enrichment,
      media: bundle.media,
      crewNotes: bundle.crewNotes,
      consent,
      config: bundle.tenant.config,
    });
    fresh = lintAsset(asset.type, asset.content, lintContextFor(ctx, consent));
  }
  const lintIds = new Set(fresh.map((c) => c.id));
  const checks = [...asset.checks.filter((c) => !lintIds.has(c.id)), ...fresh];
  const db = await getDb();
  await db.update(schema.assets).set({ checks, updatedAt: new Date() }).where(eq(schema.assets.id, assetId));
  return checks;
}
