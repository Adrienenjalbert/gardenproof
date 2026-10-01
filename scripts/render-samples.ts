/**
 * Render the client-review sample videos for the seeded demo jobs into review/videos/.
 *
 *   PGLITE_DIR=.data/mod-c/pglite STORAGE_DIR=.data/mod-c/storage pnpm seed
 *   PGLITE_DIR=.data/mod-c/pglite STORAGE_DIR=.data/mod-c/storage npx tsx scripts/render-samples.ts [--only <substring>]
 *
 * Every template × every ratio for job_pond (before + after) and job_patio (after only + real
 * testimonial), plus a contact sheet PNG per video. Props come from the real props builder with
 * the seeded data; the only override is noted below. Nothing is written to the database.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { VIDEO_RATIOS, VIDEO_TEMPLATES, type VideoRatio, type VideoTemplate } from "@/lib/domain";
import { buildVideoPlan, daysOnSite, defaultHook, type VideoPlanInput, type VideoSpec } from "@/lib/video/props";
import { closeVideoRenderer, renderToFiles } from "@/lib/video/render";

const OUT = path.join(process.cwd(), "review", "videos");
const ALL: Record<VideoTemplate, VideoRatio[]> = { reveal: [...VIDEO_RATIOS], proof: [...VIDEO_RATIOS], process: [...VIDEO_RATIOS] };

async function planInput(jobId: string): Promise<VideoPlanInput> {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) throw new Error(`${jobId} not found: run the seed first (see header).`);
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, job.tenantId));
  const media = await db.select().from(schema.media).where(eq(schema.media.jobId, jobId));
  const [testimonial] = await db
    .select()
    .from(schema.testimonials)
    .where(eq(schema.testimonials.jobId, jobId))
    .orderBy(desc(schema.testimonials.createdAt))
    .limit(1);
  const [customer] = job.customerId ? await db.select().from(schema.customers).where(eq(schema.customers.id, job.customerId)) : [];
  return {
    config: tenant!.config,
    job,
    media,
    testimonial: testimonial ?? null,
    customerFirstName: customer?.firstName ?? null,
    customerLastName: customer?.lastName ?? null,
    adCopy: null,
  };
}

/** Every template × ratio, including the fallbacks the production plan would skip (for review). */
function allSpecs(input: VideoPlanInput): VideoSpec[] {
  const plan = buildVideoPlan(input, { formats: ALL });
  if (plan.skipped) throw new Error(plan.skipped);
  const specs = [...plan.specs];
  for (const ratio of VIDEO_RATIOS) {
    if (specs.some((s) => s.template === "process" && s.ratio === ratio)) continue;
    // No progress shots: show how Process degrades (before → finished, or proof style if after-only).
    const proof = specs.find((s) => s.template === "proof" && s.ratio === ratio)!;
    const hook = defaultHook("process", { hasBefore: !!proof.props.beforeSrc, days: daysOnSite(input.job), area: proof.props.areaLine, hasQuote: !!proof.props.quote, rating: proof.props.rating });
    specs.push({ ...proof, template: "process", title: proof.title.replace("Proof", "Process"), hook, props: { ...proof.props, hook } });
  }
  return specs.sort((a, b) => VIDEO_TEMPLATES.indexOf(a.template) - VIDEO_TEMPLATES.indexOf(b.template));
}

/** ~6 evenly spaced frames tiled into one PNG so the client can scan a video at a glance. */
function contactSheet(mp4: string, png: string, ratio: VideoRatio, durationSec: number) {
  const [cols, rows, w] = ratio === "9:16" ? [6, 1, 320] : ratio === "1:1" ? [3, 2, 420] : [3, 2, 560];
  const n = cols * rows;
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-i", mp4,
    "-vf", `fps=${n}/${durationSec},scale=${w}:-2,tile=${cols}x${rows}:padding=8:margin=8:color=white`,
    "-frames:v", "1", png,
  ]);
}

async function main() {
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
  fs.mkdirSync(OUT, { recursive: true });

  const pond = await planInput("job_pond");
  // The seed leaves job_pond "awaiting testimonial", so there is no consent yet. For the review
  // samples we assume a response with photo + area consent only (NO quote, NO rating are invented;
  // consentQuote is false) and say so.
  pond.testimonial = {
    status: "responded", rating: null, quote: null,
    consentPhotos: true, consentArea: true, consentFirstName: false, consentQuote: false, withdrawnAt: null,
  };
  const patio = await planInput("job_patio"); // real seeded testimonial: 5★, quote, full consent

  const jobs: [string, VideoPlanInput][] = [
    ["pond", pond],
    ["patio", patio],
  ];
  const results: Record<string, unknown>[] = [];
  const t0 = Date.now();
  for (const [name, input] of jobs) {
    for (const spec of allSpecs(input)) {
      const base = `${name}-${spec.template}-${spec.ratio.replace(":", "x")}`;
      if (only && !base.includes(only)) continue;
      const mp4 = path.join(OUT, `${base}.mp4`);
      process.stdout.write(`${base} … `);
      const out = await renderToFiles({ template: spec.template, props: spec.props, mp4Path: mp4, thumbPath: path.join(OUT, `${base}.jpg`) });
      contactSheet(mp4, path.join(OUT, `${base}-sheet.jpg`), spec.ratio, out.durationSec);
      console.log(`${out.durationSec}s video in ${(out.renderMs / 1000).toFixed(1)}s, ${(out.bytes / 1e6).toFixed(2)} MB`);
      results.push({ file: `${base}.mp4`, title: spec.title, hook: spec.hook, ...out, checks: spec.checks });
    }
  }
  // With --only, update just the re-rendered entries and keep the rest of the manifest.
  const manifest = path.join(OUT, "renders.json");
  const previous: Record<string, unknown>[] = only && fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")) : [];
  const fresh = new Map(results.map((r) => [r.file, r]));
  const merged = [...previous.map((r) => fresh.get(r.file) ?? r), ...results.filter((r) => !previous.some((p) => p.file === r.file))];
  fs.writeFileSync(manifest, JSON.stringify(merged, null, 2));
  console.log(`\n${results.length} videos in ${((Date.now() - t0) / 1000).toFixed(0)}s → review/videos/`);
  console.log("Note: pond samples assume photo + area consent (seed has no testimonial yet); no quote or rating is shown.");
  await closeVideoRenderer();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await closeVideoRenderer().catch(() => undefined);
  process.exit(1);
});
