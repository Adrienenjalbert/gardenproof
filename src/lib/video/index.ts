/**
 * Video module: render a job's before/after ads (Remotion) into `assets` rows of type "video".
 *
 *   renderVideosForJob(jobId)   plan (consent-gated props) → upsert draft rows → render mp4 + jpg
 *   renderVideoAsset(assetId)   re-render one asset after its hook was edited (props rebuilt from
 *                               current consent/photos, so a withdrawal or a new blur is respected)
 *   recheckVideoAsset(assetId)  re-run the on-screen text checks after a hook edit
 *
 * Runs as its own background task after content generation; it screens photos itself if needed.
 *
 * Idempotent: one row per job × template × ratio. A draft / in-review / rejected row is updated in
 * place; an approved or published row is never touched — a new version row is created instead.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset } from "@/db/schema";
import { AdCopyContentSchema, VideoAssetContentSchema, type VideoRatio, type VideoTemplate } from "@/lib/domain";
import { logEvent } from "@/lib/events";
import { newId } from "@/lib/ids";
import { ensureScreened } from "@/lib/content/enrich";
import { putObject } from "@/lib/storage";
import type { TenantConfig } from "@/lib/tenant";
import { VideoPropsSchema, type VideoProps } from "../../../video/schema";
import { durationSeconds } from "../../../video/timing";
import { readOutputs, videoFormatsFor } from "@/lib/outputs";
import { buildVideoPlan, hookProblem, hookSourceCheck, type VideoCheck, type VideoPlanInput, type VideoPlanOptions, type VideoSpec } from "./props";
import type { RenderOutput } from "./render";

export { buildVideoPlan, DEFAULT_FORMATS } from "./props";
export type { VideoSpec, VideoPlanOptions } from "./props";

/** Injected in tests so the DB flow can be verified without Chromium. */
export type Renderer = (opts: {
  template: VideoTemplate;
  props: VideoProps;
  mp4Path: string;
  thumbPath?: string;
}) => Promise<RenderOutput>;

export type RenderVideosOptions = VideoPlanOptions & { renderer?: Renderer; onLog?: (msg: string) => void };

export type RenderVideosResult = { assetIds: string[]; failed: { title: string; error: string }[]; skipped: string | null };

const LOCKED = new Set(["approved", "published"]);

const ratioSlug = (r: VideoRatio) => r.replace(":", "x");

export function videoFileKeys(tenantSlug: string, jobId: string, template: VideoTemplate, ratio: VideoRatio, version: number) {
  const base = `${tenantSlug}/${jobId}/video/${template}-${ratioSlug(ratio)}${version > 1 ? `-v${version}` : ""}`;
  return { fileKey: `${base}.mp4`, thumbnailKey: `${base}.jpg` };
}

async function defaultRenderer(): Promise<Renderer> {
  const { renderToFiles } = await import("./render");
  return renderToFiles;
}

/** Hooks from the job's latest approved/published ad copy, else its latest draft (flagged as unapproved). */
async function adCopyForJob(jobId: string): Promise<VideoPlanInput["adCopy"]> {
  const db = await getDb();
  const latest = (statuses?: ("approved" | "published")[]) =>
    db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.jobId, jobId), eq(schema.assets.type, "ad_copy"), statuses ? inArray(schema.assets.status, statuses) : undefined))
      .orderBy(desc(schema.assets.version), desc(schema.assets.updatedAt))
      .limit(1);
  const [approved] = await latest(["approved", "published"]);
  const row = approved ?? (await latest())[0];
  if (!row) return null;
  const parsed = AdCopyContentSchema.safeParse(row.content);
  return parsed.success ? { hooks: parsed.data.meta.hooks, approved: !!approved } : null;
}

/** Everything buildVideoPlan needs, from the DB as it is now. */
async function planInputFor(jobId: string, config: TenantConfig): Promise<VideoPlanInput> {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) throw new Error(`Job ${jobId} not found`);
  const media = await db.select().from(schema.media).where(eq(schema.media.jobId, jobId));
  const [testimonial] = await db
    .select()
    .from(schema.testimonials)
    .where(eq(schema.testimonials.jobId, jobId))
    .orderBy(desc(schema.testimonials.createdAt))
    .limit(1);
  const [customer] = job.customerId ? await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId)) : [];
  return {
    config,
    job,
    media,
    testimonial: testimonial ?? null,
    customerFirstName: customer?.firstName ?? null,
    customerLastName: customer?.lastName ?? null,
    adCopy: await adCopyForJob(jobId),
  };
}

type Target = { assetId: string; version: number; isNew: boolean };

/**
 * Find the row to write for job × template × ratio: `preferred` (or else the latest) row when it is
 * still editable, otherwise a new version after the highest existing one.
 */
async function targetRow(jobId: string, template: VideoTemplate, ratio: VideoRatio, preferred?: Asset): Promise<Target> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.jobId, jobId), eq(schema.assets.type, "video")))
    .orderBy(desc(schema.assets.version));
  const same = rows.filter((r) => {
    const c = VideoAssetContentSchema.safeParse(r.content);
    return c.success && c.data.template === template && c.data.ratio === ratio;
  });
  const candidate = preferred ?? same[0] ?? null;
  if (candidate && !LOCKED.has(candidate.status)) return { assetId: candidate.id, version: candidate.version, isNew: false };
  return { assetId: newId("ast"), version: (same[0]?.version ?? 0) + 1, isNew: true };
}

async function renderInto(
  render: Renderer,
  tenantSlug: string,
  jobId: string,
  template: VideoTemplate,
  ratio: VideoRatio,
  version: number,
  props: VideoProps,
): Promise<{ fileKey: string; thumbnailKey: string; out: RenderOutput }> {
  const keys = videoFileKeys(tenantSlug, jobId, template, ratio, version);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gp-video-"));
  try {
    const mp4Path = path.join(dir, "out.mp4");
    const thumbPath = path.join(dir, "out.jpg");
    const out = await render({ template, props, mp4Path, thumbPath });
    await putObject(keys.fileKey, await fs.readFile(mp4Path));
    await putObject(keys.thumbnailKey, await fs.readFile(thumbPath));
    return { ...keys, out };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Write (insert or update) the asset row for one spec, render it, and attach the files. */
async function renderSpec(
  spec: VideoSpec,
  ctx: { tenantId: string; tenantSlug: string; jobId: string; render: Renderer; preferred?: Asset },
): Promise<string> {
  const db = await getDb();
  const target = await targetRow(ctx.jobId, spec.template, spec.ratio, ctx.preferred);
  const content = VideoAssetContentSchema.parse({
    template: spec.template,
    ratio: spec.ratio,
    hook: spec.hook,
    props: spec.props,
    durationSec: durationSeconds(spec.template, spec.props),
  });
  const rendered = await renderInto(ctx.render, ctx.tenantSlug, ctx.jobId, spec.template, spec.ratio, target.version, spec.props);
  const checks: VideoCheck[] = [
    ...spec.checks,
    { id: "render", ok: true, message: `Rendered ${rendered.out.durationSec}s, ${(rendered.out.bytes / 1e6).toFixed(1)} MB` },
  ];
  const row = {
    title: spec.title,
    status: "in_review" as const,
    content,
    fileKey: rendered.fileKey,
    thumbnailKey: rendered.thumbnailKey,
    checks,
    updatedAt: new Date(),
  };
  if (target.isNew) {
    await db.insert(schema.assets).values({
      id: target.assetId,
      tenantId: ctx.tenantId,
      jobId: ctx.jobId,
      type: "video",
      version: target.version,
      ...row,
    });
  } else {
    await db.update(schema.assets).set(row).where(eq(schema.assets.id, target.assetId));
  }
  await logEvent({
    tenantId: ctx.tenantId,
    type: "asset.video_rendered",
    entity: "asset",
    entityId: target.assetId,
    data: { template: spec.template, ratio: spec.ratio, version: target.version, renderMs: rendered.out.renderMs },
  });
  return target.assetId;
}

async function loadTenant(tenantId: string): Promise<{ slug: string; config: TenantConfig; settings: unknown }> {
  const db = await getDb();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
  return { slug: tenant.slug, config: tenant.config, settings: tenant.settings };
}

/**
 * Render every planned video for a job. The business's outputs setting decides the shapes: one portrait reveal
 * by default, or every format (reveal ×3, proof 9:16 + 1:1, process ×3 if progress shots) when switched on.
 */
export async function renderVideosForJob(jobId: string, options: RenderVideosOptions = {}): Promise<RenderVideosResult> {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) throw new Error(`Job ${jobId} not found`);
  const tenant = await loadTenant(job.tenantId);
  // Every photo goes through the privacy screen before it can be picked for a frame.
  await ensureScreened(jobId);
  const formats = options.formats ?? videoFormatsFor(readOutputs(tenant.settings));
  const plan = buildVideoPlan(await planInputFor(jobId, tenant.config), { ...options, formats });
  if (plan.skipped) {
    await logEvent({ tenantId: job.tenantId, type: "video.skipped", entity: "job", entityId: jobId, data: { reason: plan.skipped } });
    return { assetIds: [], failed: [], skipped: plan.skipped };
  }

  const render = options.renderer ?? (await defaultRenderer());
  const assetIds: string[] = [];
  const failed: RenderVideosResult["failed"] = [];
  // Sequential on purpose: each render already uses all cores; parallel renders thrash Chromium.
  for (const spec of plan.specs) {
    try {
      options.onLog?.(`rendering ${spec.title}`);
      assetIds.push(await renderSpec(spec, { tenantId: job.tenantId, tenantSlug: tenant.slug, jobId, render }));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ title: spec.title, error });
      await logEvent({ tenantId: job.tenantId, type: "video.render_failed", entity: "job", entityId: jobId, data: { title: spec.title, error } });
    }
  }
  if (assetIds.length === 0 && failed.length > 0) {
    throw new Error(`All video renders failed for ${jobId}: ${failed[0]!.error}`);
  }
  return { assetIds, failed, skipped: null };
}

/** Where a stored (possibly edited) hook came from: the ad copy's hooks, or the reviewer. */
function hookSource(hook: string, input: VideoPlanInput): VideoCheck {
  if (input.adCopy?.hooks.includes(hook)) return hookSourceCheck(input.adCopy.approved ? "approved" : "in_review");
  return hookSourceCheck("reviewer");
}

/**
 * Re-render one video asset after its hook was edited (`content.hook` wins). Props are rebuilt from
 * the current consent, testimonial and photos: a withdrawal, a refused quote or a new blur is
 * respected, and a hook that fails the privacy lint is refused instead of burned in.
 * Approved/published assets get a new version row. Returns the id of the asset holding the render.
 */
export async function renderVideoAsset(assetId: string, options: { renderer?: Renderer } = {}): Promise<string> {
  const db = await getDb();
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId));
  if (!asset || asset.type !== "video") throw new Error(`Video asset ${assetId} not found`);
  if (!asset.jobId) throw new Error(`Video asset ${assetId} has no job`);
  const content = VideoAssetContentSchema.parse(asset.content);
  const tenant = await loadTenant(asset.tenantId);
  const input = await planInputFor(asset.jobId, tenant.config);
  const plan = buildVideoPlan(input, { formats: { reveal: [], proof: [], process: [], [content.template]: [content.ratio] } });
  const spec = plan.specs[0];
  if (plan.skipped || !spec) {
    const reason = plan.skipped ?? `the ${content.template} video can no longer be built for this job`;
    await logEvent({ tenantId: asset.tenantId, type: "video.rerender_refused", entity: "asset", entityId: assetId, data: { reason } });
    throw new Error(`Not re-rendered: ${reason}.`);
  }
  const problem = hookProblem(content.hook, input);
  if (problem) throw new Error(`Not re-rendered: the on-screen hook can't be used (${problem}). Edit the hook and try again.`);
  const planned = spec.checks.find((c) => c.id === "hook-source");
  return renderSpec(
    {
      ...spec,
      title: asset.title,
      hook: content.hook,
      props: VideoPropsSchema.parse({ ...spec.props, hook: content.hook }),
      checks: [
        ...spec.checks.filter((c) => c.id !== "hook-source"),
        content.hook === spec.hook && planned ? planned : hookSource(content.hook, input),
      ],
    },
    {
      tenantId: asset.tenantId,
      tenantSlug: tenant.slug,
      jobId: asset.jobId,
      render: options.renderer ?? (await defaultRenderer()),
      preferred: asset,
    },
  );
}

const HOOK_PRIVACY_PREFIX = "On-screen hook can't be used: ";

/**
 * After a hook edit (before the re-render): a hook that fails the privacy lint becomes a failing
 * `privacy` check, which holds publishing; an unrendered edit is flagged. Other checks are kept.
 */
export async function recheckVideoAsset(assetId: string): Promise<VideoCheck[]> {
  const db = await getDb();
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId));
  if (!asset || asset.type !== "video" || !asset.jobId) throw new Error(`Video asset ${assetId} not found`);
  const content = VideoAssetContentSchema.parse(asset.content);
  const input = await planInputFor(asset.jobId, (await loadTenant(asset.tenantId)).config);
  const problem = hookProblem(content.hook, input);
  const rendered = content.props.hook === content.hook;
  const kept = asset.checks.filter(
    (c) =>
      c.id !== "hook-edit" &&
      !(c.id === "privacy" && c.message.startsWith(HOOK_PRIVACY_PREFIX)) &&
      !(c.id === "hook-source" && !rendered),
  );
  const checks: VideoCheck[] = [
    ...kept,
    ...(problem ? [{ id: "privacy", ok: false, message: `${HOOK_PRIVACY_PREFIX}${problem}` }] : []),
    ...(!rendered ? [hookSource(content.hook, input), { id: "hook-edit", ok: false, message: "Hook edited: re-render the video before publishing" }] : []),
  ];
  await db.update(schema.assets).set({ checks, updatedAt: new Date() }).where(eq(schema.assets.id, assetId));
  return checks;
}
