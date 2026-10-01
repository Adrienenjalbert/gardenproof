/**
 * Publisher: takes an agency-approved asset public.
 *
 *   portfolio_page / seo_article → WordPress (gp_project / gp_article) or, with no WP creds, the local preview
 *   ad_copy / video              → ad bundle export (Google Ads Editor + Meta CSVs + mp4s)
 *   social_pack / gbp_post       → text hand-off export (API posting is Phase 2)
 *
 * Assets with a failing consent/privacy check are held (see ./checks), even when approved.
 * Safe to re-run: re-publishing updates the same WordPress post / overwrites the same export folder.
 * On failure the asset keeps its status (approved stays approved), the error is noted on the asset for the
 * operator and logged, and a clean PublishError is thrown.
 *
 * `unpublishAsset` is the reverse (consent withdrawal, P1-8): WordPress posts go back to draft and their
 * uploaded photos are deleted; every asset is marked rejected so no feed, preview, export or media URL serves it.
 */
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { getDb, schema } from "@/db";
import { isLocalPublishing } from "@/lib/config";
import { ASSET_CONTENT_SCHEMAS, PortfolioPageContentSchema, type AssetStatus } from "@/lib/domain";
import { logEvent } from "@/lib/events";
import { getTenant } from "@/lib/tenants";
import { blockingChecks } from "./checks";
import { loadAsset } from "./data";
import { HANDLERS, wpClient, type PublishOutcome } from "./handlers";
import { WP_REST_BASE } from "./wordpress";

export { blockingChecks, isBlockingCheckId } from "./checks";

export class PublishError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PublishError";
  }
}

export type PublishResult = PublishOutcome & { assetId: string; status: "published" };

/** "published" is allowed so an already-live asset can be re-synced (idempotent update). */
const PUBLISHABLE: AssetStatus[] = ["approved", "published"];
const FAILURE_PREFIX = "Publish failed: ";

/** Keep operator notes, replacing any previous publish error line. Pass null to just clear it. */
export function withPublishError(notes: string | null, message: string | null): string | null {
  const kept = (notes ?? "").split("\n").filter((line) => line.trim() && !line.startsWith(FAILURE_PREFIX));
  if (message) kept.push(`${FAILURE_PREFIX}${message}`);
  return kept.length ? kept.join("\n") : null;
}

export function describePublishError(err: unknown): string {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return `content is invalid (${first ? `${first.path.join(".") || "root"}: ${first.message}` : "schema mismatch"})`;
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 300 ? `${message.slice(0, 297)}…` : message;
}

export async function publishAsset(assetId: string): Promise<PublishResult> {
  const asset = await loadAsset(assetId);
  if (!asset) throw new PublishError(`Asset ${assetId} not found`);
  if (!PUBLISHABLE.includes(asset.status)) {
    throw new PublishError(`Only approved assets can be published (this one is "${asset.status}").`);
  }
  const db = await getDb();
  const tenant = await getTenant(asset.tenantId);

  let outcome: PublishOutcome;
  try {
    const blocked = blockingChecks(asset.checks);
    if (blocked.length) throw new Error(`held by failing checks (${blocked.join("; ")})`);
    ASSET_CONTENT_SCHEMAS[asset.type].parse(asset.content);
    outcome = await HANDLERS[asset.type](asset, tenant);
  } catch (err) {
    const message = describePublishError(err);
    await db
      .update(schema.assets)
      .set({ reviewNotes: withPublishError(asset.reviewNotes, message), updatedAt: new Date() })
      .where(eq(schema.assets.id, asset.id));
    await logEvent({
      tenantId: asset.tenantId,
      type: "asset.publish_failed",
      entity: "asset",
      entityId: asset.id,
      data: { type: asset.type, version: asset.version, message },
    });
    throw new PublishError(`Publishing "${asset.title}" failed: ${message}`, { cause: err });
  }

  const now = new Date();
  await db
    .update(schema.assets)
    .set({
      status: "published",
      publishedAt: asset.publishedAt ?? now,
      externalId: outcome.externalId,
      externalUrl: outcome.externalUrl,
      reviewNotes: withPublishError(asset.reviewNotes, null),
      updatedAt: now,
    })
    .where(eq(schema.assets.id, asset.id));
  await logEvent({
    tenantId: asset.tenantId,
    type: "asset.published",
    entity: "asset",
    entityId: asset.id,
    data: { type: asset.type, version: asset.version, mode: outcome.mode, externalUrl: outcome.externalUrl },
  });

  if (asset.type === "portfolio_page" && asset.jobId) {
    await db.update(schema.jobs).set({ status: "published", updatedAt: now }).where(eq(schema.jobs.id, asset.jobId));
  }
  return { ...outcome, assetId: asset.id, status: "published" };
}

export type UnpublishResult = { assetId: string; mode: "wordpress" | "local"; deletedMedia: number };

/**
 * Take an asset down (idempotent; safe to retry from a task). WordPress: the post is set to draft and the
 * photos uploaded for it are deleted. Everywhere: status "rejected" + reviewNotes "Withdrawn: <reason>", which
 * removes it from /portfolio, the JSON feed, public previews, exports and /api/media.
 * WordPress errors propagate (nothing is marked) so the caller's retry can finish the job.
 */
export async function unpublishAsset(assetId: string, reason: string): Promise<UnpublishResult> {
  const asset = await loadAsset(assetId);
  if (!asset) throw new PublishError(`Asset ${assetId} not found`);

  let mode: UnpublishResult["mode"] = "local";
  let deletedMedia = 0;
  const onWordPress =
    (asset.type === "portfolio_page" || asset.type === "seo_article") && !!asset.externalId && !isLocalPublishing();
  if (onWordPress) {
    mode = "wordpress";
    const client = wpClient();
    await client.unpublishPost(WP_REST_BASE[asset.type as keyof typeof WP_REST_BASE], asset.externalId!);
    const content = PortfolioPageContentSchema.safeParse(asset.content);
    if (asset.type === "portfolio_page" && content.success) {
      const ids = new Set([
        ...content.data.gallery.map((g) => g.mediaId),
        ...(content.data.beforeAfter ? [content.data.beforeAfter.beforeMediaId, content.data.beforeAfter.afterMediaId] : []),
      ]);
      for (const id of ids) if (await client.deleteMedia(id)) deletedMedia++;
    }
  }

  const db = await getDb();
  await db
    .update(schema.assets)
    .set({ status: "rejected", reviewNotes: `Withdrawn: ${reason}`, updatedAt: new Date() })
    .where(eq(schema.assets.id, asset.id));
  await logEvent({
    tenantId: asset.tenantId,
    type: "asset.unpublished",
    entity: "asset",
    entityId: asset.id,
    data: { type: asset.type, previousStatus: asset.status, reason, mode, deletedMedia, externalUrl: asset.externalUrl },
  });
  return { assetId: asset.id, mode, deletedMedia };
}
