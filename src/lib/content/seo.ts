/**
 * Area guides ("Patios & paving in Putney"): one seo_article per (service, area) cluster,
 * created only when at least 2 real projects back it — no thin pages.
 * Only APPROVED or PUBLISHED portfolio pages with a consented area (facts.area set) count toward a
 * cluster: an article must never restate facts the operator has not signed off.
 * Call refreshSeoCluster again when a portfolio page is approved/published (publisher hook).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset } from "@/db/schema";
import type { PortfolioPageContent } from "@/lib/domain";
import { logEvent } from "@/lib/events";
import { serviceLabel, type TenantConfig } from "@/lib/tenant";
import { tenantView } from "./context";
import { writeSeoArticle, seoSlug } from "./generate";
import { SERVICE_NOUNS } from "./lexicon";
import { saveAssetVersion, type SaveResult } from "./persist";
import type { SeoClusterPage, SeoContext } from "./types";

export const MIN_CLUSTER_PAGES = 2;
const SIGNED_OFF = ["approved", "published"] as const;

export type ClusterKey = { tenantId: string; service: string; area: string };

async function clusterPages(key: ClusterKey, projectsUrl: string): Promise<SeoClusterPage[]> {
  const db = await getDb();
  const rows = await db
    .select({ asset: schema.assets, jobService: schema.jobs.service })
    .from(schema.assets)
    .innerJoin(schema.jobs, eq(schema.assets.jobId, schema.jobs.id))
    .where(
      and(
        eq(schema.assets.tenantId, key.tenantId),
        eq(schema.assets.type, "portfolio_page"),
        inArray(schema.assets.status, [...SIGNED_OFF]),
        eq(schema.jobs.service, key.service),
      ),
    );
  // Latest version per job, and only pages that publicly name this area.
  const latest = new Map<string, (typeof rows)[number]["asset"]>();
  for (const { asset } of rows) {
    const prev = latest.get(asset.jobId!);
    if (!prev || asset.version > prev.version) latest.set(asset.jobId!, asset);
  }
  return [...latest.values()]
    .map((a) => ({ a, c: a.content as unknown as PortfolioPageContent }))
    .filter(({ c }) => c.facts?.area === key.area)
    .sort((x, y) => x.a.createdAt.getTime() - y.a.createdAt.getTime())
    .map(({ a, c }) => ({
      jobId: a.jobId!,
      slug: c.slug,
      h1: c.h1,
      summary: c.summary,
      materials: c.facts.materials,
      features: c.facts.features,
      duration: c.facts.duration,
      url: `${projectsUrl.replace(/\/$/, "")}/${c.slug}/`,
    }));
}

/** The writer's context for one cluster (signed-off pages only). */
export async function seoContextFor(key: ClusterKey, config: TenantConfig, instructions: string | null): Promise<SeoContext> {
  const tenant = tenantView(config, null);
  const label = serviceLabel(key.service, config);
  return {
    tenant,
    service: key.service,
    serviceLabel: label,
    serviceNoun: SERVICE_NOUNS[key.service] ?? label.toLowerCase(),
    area: key.area,
    pages: await clusterPages(key, tenant.projectsUrl),
    year: new Date().getFullYear(),
    instructions,
  };
}

/** Which (service, area) cluster an existing article belongs to, from its first related job. */
export async function clusterKeyForArticle(article: Asset): Promise<{ key: ClusterKey; config: TenantConfig }> {
  const db = await getDb();
  const jobIds = (article.content as { relatedJobIds?: string[] }).relatedJobIds ?? [];
  const [row] = jobIds.length
    ? await db
        .select({ job: schema.jobs, tenant: schema.tenants })
        .from(schema.jobs)
        .innerJoin(schema.tenants, eq(schema.jobs.tenantId, schema.tenants.id))
        .where(eq(schema.jobs.id, jobIds[0]))
    : [];
  const [page] = row
    ? await db
        .select()
        .from(schema.assets)
        .where(and(eq(schema.assets.jobId, row.job.id), eq(schema.assets.type, "portfolio_page")))
        .orderBy(desc(schema.assets.version))
        .limit(1)
    : [];
  const area = (page?.content as PortfolioPageContent | undefined)?.facts?.area;
  if (!row?.job.service || !area) throw new Error("Cannot find the service/area cluster for this article.");
  return { key: { tenantId: article.tenantId, service: row.job.service, area }, config: row.tenant.config };
}

/** Create or refresh the cluster article. Returns null when the cluster is too thin. */
export async function refreshSeoCluster(key: ClusterKey, config: TenantConfig, instructions: string | null = null): Promise<SaveResult | null> {
  const ctx = await seoContextFor(key, config, instructions);
  const { pages } = ctx;
  if (pages.length < MIN_CLUSTER_PAGES) {
    await logEvent({ tenantId: key.tenantId, type: "content.seo_skipped_thin", data: { ...key, pages: pages.length } });
    return null;
  }
  const label = ctx.serviceLabel;
  const written = await writeSeoArticle(ctx);
  const saved = await saveAssetVersion({
    tenantId: key.tenantId,
    jobId: null,
    type: "seo_article",
    title: written.title,
    content: written.content,
    checks: written.checks,
    slug: seoSlug(label, key.area),
  });
  await logEvent({ tenantId: key.tenantId, type: "content.seo_refreshed", entity: "asset", entityId: saved.assetId, data: { ...key, pages: pages.length, version: saved.version } });
  return saved;
}
