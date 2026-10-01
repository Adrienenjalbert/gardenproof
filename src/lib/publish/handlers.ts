/**
 * Per-asset-type publish handlers. Each returns where the asset now lives; the orchestrator in ./index.ts
 * owns status changes, audit events and error handling.
 */
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset, Job, Tenant } from "@/db/schema";
import { env, isLocalPublishing } from "@/lib/config";
import {
  AdCopyContentSchema,
  GbpPostContentSchema,
  PortfolioPageContentSchema,
  SocialPackContentSchema,
  VideoAssetContentSchema,
  type AssetType,
} from "@/lib/domain";
import { getObject, publicUrl } from "@/lib/storage";
import { serviceLabel } from "@/lib/tenant";
import { buildGooglePmaxRows, buildMetaRows, type AdCopyInput, type VideoInput } from "./ad-bundle";
import { blockingChecks } from "./checks";
import { loadPublicConsent } from "./consent";
import { toCsv } from "./csv";
import { articleViewFor, mediaForJobs, portfolioViewFor } from "./data";
import { exportFolder, exportUrl, writeExport, type ExportFile } from "./exports";
import { gbpPostText, socialPackText, type ExportImage } from "./social-export";
import { projectUrl, type PortfolioView, type PublicImage } from "./view";
import { createWpClient, WP_REST_BASE } from "./wordpress";
import { toWpArticlePayload, toWpProjectPayload } from "./wp-mappers";

export type PublishOutcome = {
  externalId: string | null;
  externalUrl: string;
  mode: "wordpress" | "local" | "export";
};

type Handler = (asset: Asset, tenant: Tenant) => Promise<PublishOutcome>;

async function jobFor(asset: Asset): Promise<Job> {
  if (!asset.jobId) throw new Error(`${asset.type} assets must belong to a job`);
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, asset.jobId));
  if (!job) throw new Error(`Job ${asset.jobId} not found`);
  return job;
}

// ---------------------------------------------------------------------------------------------------------
// Portfolio pages & articles → WordPress (or local preview)
// ---------------------------------------------------------------------------------------------------------

export function wpClient() {
  const { baseUrl, user, appPassword } = env.wordpress;
  return createWpClient({ baseUrl: baseUrl!, user: user!, appPassword: appPassword!, readObject: getObject });
}

/** Replace every occurrence of an uploaded image (hero is often the same photo as the "after"). */
function withWpImages(view: PortfolioView, uploaded: Map<string, { id: number; url: string }>): PortfolioView {
  const swap = (img: PublicImage): PublicImage => {
    const up = uploaded.get(img.mediaId);
    return up ? { ...img, src: up.url, wpId: up.id } : img;
  };
  return {
    ...view,
    hero: view.hero && swap(view.hero),
    beforeAfter: view.beforeAfter && { before: swap(view.beforeAfter.before), after: swap(view.beforeAfter.after) },
    gallery: view.gallery.map(swap),
  };
}

const publishPage: Handler = async (asset, tenant) => {
  if (isLocalPublishing()) return { externalId: null, externalUrl: `/preview/${asset.id}`, mode: "local" };
  const client = wpClient();

  if (asset.type === "seo_article") {
    const view = await articleViewFor(asset, tenant);
    const post = await client.upsertPost(WP_REST_BASE.seo_article, toWpArticlePayload(view), asset.externalId);
    return { externalId: String(post.id), externalUrl: post.link, mode: "wordpress" };
  }

  const base = await portfolioViewFor(asset, tenant, "absolute");
  const images = [base.hero, base.beforeAfter?.before, base.beforeAfter?.after, ...base.gallery].filter(
    (img): img is PublicImage => !!img,
  );
  // Storage keys stay server-side: resolved here from the same publishable-key rule the view used.
  const keys = new Map((await mediaForJobs(asset.jobId ? [asset.jobId] : [])).map((m) => [m.id, m.publicKey]));
  const uploaded = new Map<string, { id: number; url: string }>();
  for (const img of images) {
    const key = keys.get(img.mediaId);
    if (!key) throw new Error(`image ${img.mediaId} is no longer publishable`);
    if (!uploaded.has(img.mediaId)) uploaded.set(img.mediaId, await client.ensureMedia(img, key));
  }
  let view = withWpImages(base, uploaded);
  let post = await client.upsertPost(WP_REST_BASE.portfolio_page, toWpProjectPayload(view), asset.externalId);
  if (post.link && post.link !== view.canonicalUrl) {
    // WordPress chose a different permalink (slug clash, custom base): re-save so JSON-LD points at the real URL.
    view = { ...view, canonicalUrl: post.link };
    post = await client.upsertPost(WP_REST_BASE.portfolio_page, toWpProjectPayload(view), String(post.id));
  }
  return { externalId: String(post.id), externalUrl: post.link, mode: "wordpress" };
};

// ---------------------------------------------------------------------------------------------------------
// Ad copy + videos → ad bundle export (Google Ads Editor + Meta CSVs + mp4s)
// ---------------------------------------------------------------------------------------------------------

/**
 * Where ad clicks land: the job's own project page, never a generic listing (QA B7).
 * 1. the published portfolio page's live URL (WordPress permalink, or the public preview in local mode);
 * 2. WordPress publishing: the page's expected permalink `${baseUrl}${projectsPath}${slug}/`;
 * 3. local publishing: the page's preview URL (public as soon as the page is published);
 * 2 and 3 are warned (they 404 until the page is published). With no portfolio page at all: the CTA page.
 */
export async function landingUrl(job: Job, tenant: Tenant): Promise<{ url: string; warning: string | null }> {
  const db = await getDb();
  const pages = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.jobId, job.id), eq(schema.assets.type, "portfolio_page")))
    .orderBy(desc(schema.assets.version), desc(schema.assets.updatedAt));
  const live = pages.find((p) => p.status === "published" && p.externalUrl);
  if (live?.externalUrl) return { url: new URL(live.externalUrl, env.appUrl).toString(), warning: null };

  const pending = "The project page is not published yet: publish it before the ads go live, or the final URL will 404.";
  const page = pages.find((p) => p.status !== "rejected" && PortfolioPageContentSchema.safeParse(p.content).success);
  if (page && !isLocalPublishing() && tenant.config.wordpress) {
    const { slug } = PortfolioPageContentSchema.parse(page.content);
    return { url: projectUrl(tenant.config, slug), warning: pending };
  }
  if (page) return { url: new URL(`/preview/${page.id}`, env.appUrl).toString(), warning: pending };
  return {
    url: tenant.config.cta.url,
    warning: "No portfolio page for this job: ads point at the enquiry page instead.",
  };
}

/** A sibling may join an export only if it is itself publishable (approved/published, no blocking check). */
function exportable(a: Asset): boolean {
  return (a.status === "approved" || a.status === "published") && blockingChecks(a.checks).length === 0;
}

const publishAdBundle: Handler = async (asset, tenant) => {
  const job = await jobFor(asset);
  const db = await getDb();
  const candidates = await db
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.jobId, job.id),
        inArray(schema.assets.type, ["ad_copy", "video"] satisfies AssetType[]),
        or(inArray(schema.assets.status, ["approved", "published"]), eq(schema.assets.id, asset.id)),
      ),
    );
  const warnings: string[] = [];
  // The asset being published was already checked by the orchestrator; siblings must pass the same bar.
  const siblings = candidates.filter((a) => a.id === asset.id || exportable(a));
  for (const held of candidates.filter((a) => !siblings.includes(a))) {
    warnings.push(`${held.title} left out: held by failing checks (${blockingChecks(held.checks).join("; ")}).`);
  }

  const ads: AdCopyInput[] = siblings
    .filter((a) => a.type === "ad_copy")
    .map((a) => ({ assetId: a.id, content: AdCopyContentSchema.parse(a.content) }));
  const files: ExportFile[] = [];
  const videos: VideoInput[] = [];
  for (const v of siblings.filter((a) => a.type === "video")) {
    const content = VideoAssetContentSchema.parse(v.content);
    const fileName = `${content.template}-${content.ratio.replace(":", "x")}-${v.id}.mp4`.toLowerCase();
    if (v.fileKey) {
      files.push({ name: fileName, data: await getObject(v.fileKey), contentType: "video/mp4" });
      videos.push({ assetId: v.id, fileName, content });
    } else {
      warnings.push(`Video ${content.template} ${content.ratio} is not rendered yet — left out.`);
    }
  }

  const landing = await landingUrl(job, tenant);
  if (landing.warning) warnings.push(landing.warning);
  const ctx = {
    jobCode: job.code,
    area: job.area,
    serviceLabel: job.service ? serviceLabel(job.service, tenant.config) : "Landscaping",
    businessName: tenant.config.name,
    finalUrl: landing.url,
    utmCampaign: `gp_${job.code.toLowerCase()}`,
  };
  if (ads.length) {
    const google = buildGooglePmaxRows(ads, ctx);
    const meta = buildMetaRows(ads, videos, ctx);
    warnings.push(...google.warnings, ...meta.warnings);
    files.unshift(
      { name: "google-pmax.csv", data: toCsv(google.rows), contentType: "text/csv; charset=utf-8" },
      { name: "meta-ads.csv", data: toCsv(meta.rows), contentType: "text/csv; charset=utf-8" },
    );
  } else {
    warnings.push("No approved ad copy for this job yet — bundle contains videos only.");
  }

  const folder = exportFolder(job.id, "ads");
  await writeExport(folder, files, {
    kind: "ads",
    title: `Ad bundle — ${job.title ?? job.code}`,
    jobId: job.id,
    assetIds: siblings.map((s) => s.id),
    warnings,
    notes: [
      "google-pmax.csv: Google Ads Editor → Account → Import → From file (Performance Max asset group).",
      "meta-ads.csv: Meta Ads Manager → Export & import → Import ads in bulk; upload the mp4s to the ad account first.",
      "Every URL carries utm_content=asset_<id>; enquiries from these ads are attributed in the lead log.",
    ],
  });
  return { externalId: folder, externalUrl: exportUrl(asset.id), mode: "export" };
};

// ---------------------------------------------------------------------------------------------------------
// Social pack / GBP post → text hand-off (Phase 2: Meta + Business Profile APIs)
// ---------------------------------------------------------------------------------------------------------

/** Publishable photos only (publishableImageKey via mediaForJobs), and none if the homeowner refused/withdrew. */
async function publicImages(jobId: string): Promise<ExportImage[]> {
  const consent = (await loadPublicConsent([jobId])).get(jobId);
  if (consent?.withdrawn || consent?.photos === false) return [];
  return (await mediaForJobs([jobId])).flatMap((m) =>
    m.publicKey ? [{ mediaId: m.id, url: publicUrl(m.publicKey, true) }] : [],
  );
}

const publishSocial: Handler = async (asset) => {
  const job = await jobFor(asset);
  const pack = SocialPackContentSchema.parse(asset.content);
  const images = await publicImages(job.id);
  const meta = { title: job.title ?? asset.title, jobCode: job.code };
  const folder = exportFolder(job.id, "social");
  await writeExport(
    folder,
    [{ name: "social-pack.txt", data: socialPackText(pack, images, meta), contentType: "text/plain; charset=utf-8" }],
    {
      kind: "social",
      title: `Social pack — ${meta.title}`,
      jobId: job.id,
      assetIds: [asset.id],
      warnings: [],
      notes: ["Image keys: " + pack.carouselOrder.join(", "), "Schedule in Meta Business Suite. API posting is Phase 2."],
    },
  );
  return { externalId: folder, externalUrl: exportUrl(asset.id), mode: "export" };
};

const publishGbp: Handler = async (asset) => {
  const job = await jobFor(asset);
  const post = GbpPostContentSchema.parse(asset.content);
  const image = post.mediaId ? ((await publicImages(job.id)).find((i) => i.mediaId === post.mediaId) ?? null) : null;
  const meta = { title: job.title ?? asset.title, jobCode: job.code };
  const folder = exportFolder(job.id, "gbp");
  await writeExport(
    folder,
    [{ name: "gbp-post.txt", data: gbpPostText(post, image, meta), contentType: "text/plain; charset=utf-8" }],
    {
      kind: "gbp",
      title: `Google Business Profile post — ${meta.title}`,
      jobId: job.id,
      assetIds: [asset.id],
      warnings: post.mediaId && !image ? ["The chosen photo is not public-safe yet."] : [],
      notes: ["Post via Google Business Profile → Add update. Business Profile API posting is Phase 2."],
    },
  );
  return { externalId: folder, externalUrl: exportUrl(asset.id), mode: "export" };
};

export const HANDLERS: Record<AssetType, Handler> = {
  portfolio_page: publishPage,
  seo_article: publishPage,
  ad_copy: publishAdBundle,
  video: publishAdBundle,
  social_pack: publishSocial,
  gbp_post: publishGbp,
};
