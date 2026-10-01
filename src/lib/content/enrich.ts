/**
 * enrichJob: turn photos + crew notes into structured JobEnrichment and per-image quality.
 * Missing voice-note transcripts are filled first (Whisper when OPENAI_API_KEY is set).
 *
 * Privacy screening covers EVERY image, in batches of IMAGE_BATCH per vision call. An image the
 * model did not assess (batch failed, file missing, left out of the answer) is marked
 * UNSCREENED_NOTE, which the shared privacy rule treats exactly like "needs blur": withheld until
 * blurred or cleared by the operator. Unscreened never means safe.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { generate } from "@/lib/ai/client";
import { metricQuality, prepareImage, type AiImage, type ImageMetrics } from "@/lib/ai/images";
import { getTranscriber, type Transcriber } from "@/lib/ai/transcribe";
import { JobEnrichmentSchema, type JobEnrichment } from "@/lib/domain";
import { logEvent } from "@/lib/events";
import { getObject, mimeFromKey } from "@/lib/storage";
import type { Media } from "@/db/schema";
import { EnrichmentDraftSchema, type EnrichmentDraft, type ImageAssessment } from "./drafts";
import { loadJobBundle } from "./load";

/** Images per vision call (token budget), not a cap: all images are screened. */
export const IMAGE_BATCH = 8;
/** Matches NEEDS_BLUR in @/lib/privacy on purpose, so an unscreened image is never public. */
export const UNSCREENED_NOTE = "needs blur: not privacy-screened";

export function batches<T>(items: T[], size = IMAGE_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * True when an image still has to go through the privacy screen (never enriched, or a batch failed).
 * An operator clearance or a real blurred copy settles it: no need to ask the model again.
 */
export const needsScreening = (m: Pick<Media, "kind" | "qualityScore" | "qualityNotes" | "privacyClearedAt" | "blurredKey">) =>
  m.kind === "image" && !m.privacyClearedAt && !m.blurredKey && (m.qualityScore == null || (m.qualityNotes ?? "").includes(UNSCREENED_NOTE));

async function fillTranscripts(jobId: string, transcriber: Transcriber): Promise<number> {
  if (transcriber.name === "none") return 0;
  const db = await getDb();
  const audio = await db.select().from(schema.media).where(eq(schema.media.jobId, jobId));
  let done = 0;
  for (const m of audio.filter((x) => x.kind === "audio" && !x.transcript)) {
    const buf = await getObject(m.storageKey).catch(() => null);
    if (!buf) continue;
    const text = await transcriber.transcribe(buf, m.mimeType ?? mimeFromKey(m.storageKey));
    if (text) {
      await db.update(schema.media).set({ transcript: text }).where(eq(schema.media.id, m.id));
      done++;
    }
  }
  return done;
}

/**
 * Combine the model's view with deterministic metrics: the stricter verdict wins.
 * No assessment (not screened) -> UNSCREENED_NOTE, so the image is withheld.
 */
export function qualityVerdict(a: ImageAssessment | undefined, metrics: ImageMetrics | null): { score: number; notes: string } {
  const m = metrics ? metricQuality(metrics) : { score: 0.5, notes: [] as string[] };
  if (!a) return { score: m.score, notes: [UNSCREENED_NOTE, ...m.notes].join("; ") };
  const privacy = [
    a?.facesVisible && "faces visible",
    a?.peopleVisible && !a?.facesVisible && "people visible",
    a?.numberPlatesVisible && "number plate visible",
    a?.houseNumberVisible && "house number visible",
  ].filter((x): x is string => !!x);
  const notes = [...new Set([...(a?.notes ?? []), ...m.notes])];
  if (privacy.length) notes.unshift(`needs blur: ${privacy.join(", ")}`);
  const score = Math.min(a?.qualityScore ?? m.score, m.score);
  return { score: Math.round(score * 100) / 100, notes: notes.join("; ") };
}

/** Hero ids must be this job's images with the right stage; otherwise fall back to the best-scored one. */
export function validHero(
  proposed: string | null,
  stage: "before" | "after",
  images: { id: string; stage: string; score: number; blocked: boolean }[],
): string | null {
  const ok = images.find((i) => i.id === proposed && i.stage === stage && !i.blocked);
  if (ok) return ok.id;
  return images.filter((i) => i.stage === stage && !i.blocked).sort((a, b) => b.score - a.score)[0]?.id ?? null;
}

type Batch = { rows: Media[]; draft: EnrichmentDraft | null; provider?: string; model?: string; promptVersion?: number };

export async function enrichJob(jobId: string, opts: { transcriber?: Transcriber } = {}): Promise<JobEnrichment> {
  const transcribed = await fillTranscripts(jobId, opts.transcriber ?? getTranscriber());
  const { job, tenant, media, crewNotes } = await loadJobBundle(jobId);
  const config = tenant.config;
  const imageRows = media.filter((m) => m.kind === "image");
  const serviceKeys = config.services.map((s) => s.key);
  const metrics = new Map<string, ImageMetrics | null>();
  const screened = new Set<string>();

  // One vision call per batch. The first successful batch also yields the job-level facts.
  const done: Batch[] = [];
  const groups = imageRows.length ? batches(imageRows) : [[]];
  for (const [i, rows] of groups.entries()) {
    const prepared = await Promise.all(rows.map((m) => prepareImage(m)));
    rows.forEach((m, k) => metrics.set(m.id, prepared[k]?.metrics ?? null));
    const images: AiImage[] = prepared.flatMap((p) => (p ? [p.image] : []));
    try {
      const res = await generate("enrichment", EnrichmentDraftSchema, {
        prompt: "enrichment",
        vars: {
          tenantName: config.name,
          context: JSON.stringify({ jobCode: job.code, service: job.service, title: job.title, crewNotes: crewNotes || "(no notes)" }, null, 2),
          serviceKeys: serviceKeys.join(", "),
          jobService: job.service ?? "unknown",
          mediaList: rows.map((m) => `- ${m.id} (${m.stage})`).join("\n") || "- none",
          metrics: rows
            .map((m) => {
              const x = metrics.get(m.id);
              return `- ${m.id}: ${x ? `brightness ${x.brightness.toFixed(2)}, sharpness ${x.sharpness.toFixed(2)}, ${x.width}x${x.height}` : "file unavailable"}`;
            })
            .join("\n") || "- none",
        },
        data: {
          crewNotes,
          jobService: job.service,
          serviceKeys,
          images: rows.map((m) => ({ mediaId: m.id, stage: m.stage, metrics: metrics.get(m.id) ?? null })),
        },
        images,
        maxTokens: 3000,
      });
      // Only images the model actually saw count as screened.
      const seen = new Set(images.map((im) => im.mediaId));
      for (const a of res.data.images) if (seen.has(a.mediaId)) screened.add(a.mediaId);
      done.push({ rows, draft: res.data, provider: res.provider, model: res.model, promptVersion: res.promptVersion });
    } catch (err) {
      if (i === 0 && groups.length === 1) throw err;
      done.push({ rows, draft: null });
      await logEvent({
        tenantId: job.tenantId,
        type: "job.enrich_batch_failed",
        entity: "job",
        entityId: jobId,
        data: { batch: i, media: rows.map((m) => m.id), error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  const first = done.find((b) => b.draft);
  if (!first?.draft) throw new Error(`Enrichment failed for every image batch of ${jobId}`);
  const draft = first.draft;

  const byId = new Map<string, ImageAssessment>();
  for (const b of done) for (const a of b.draft?.images ?? []) if (screened.has(a.mediaId)) byId.set(a.mediaId, a);
  const verdicts = imageRows.map((m) => ({ m, v: qualityVerdict(byId.get(m.id), metrics.get(m.id) ?? null) }));
  const heroPool = verdicts.map(({ m, v }) => ({ id: m.id, stage: m.stage, score: v.score, blocked: /needs blur/.test(v.notes) }));
  const proposed = (key: "heroBeforeMediaId" | "heroAfterMediaId", stage: "before" | "after") =>
    done.map((b) => b.draft?.[key] ?? null).find((id) => heroPool.some((h) => h.id === id && h.stage === stage && !h.blocked)) ?? null;

  const enrichment = JobEnrichmentSchema.parse({
    ...draft,
    service: serviceKeys.includes(draft.service) ? draft.service : (job.service ?? draft.service),
    heroBeforeMediaId: validHero(proposed("heroBeforeMediaId", "before"), "before", heroPool),
    heroAfterMediaId: validHero(proposed("heroAfterMediaId", "after"), "after", heroPool),
  });

  const db = await getDb();
  for (const { m, v } of verdicts) {
    await db
      .update(schema.media)
      .set({
        qualityScore: v.score,
        qualityNotes: v.notes || null,
        isHero: m.id === enrichment.heroBeforeMediaId || m.id === enrichment.heroAfterMediaId,
      })
      .where(eq(schema.media.id, m.id));
  }
  await db.update(schema.jobs).set({ enrichment, updatedAt: new Date() }).where(eq(schema.jobs.id, jobId));
  await logEvent({
    tenantId: job.tenantId,
    type: "job.enriched",
    entity: "job",
    entityId: jobId,
    data: {
      provider: first.provider,
      model: first.model,
      promptVersion: first.promptVersion,
      images: imageRows.length,
      batches: groups.length,
      transcribed,
      needsBlur: verdicts.filter(({ v }) => /needs blur/.test(v.notes)).map(({ m }) => m.id),
      unscreened: imageRows.filter((m) => !screened.has(m.id)).map((m) => m.id),
    },
  });
  return enrichment;
}

/**
 * Screen before anything public is built: (re-)enrich when the job was never enriched or any
 * image is still unscreened (arrived later, or a batch failed last time). Returns true if it ran.
 */
export async function ensureScreened(jobId: string): Promise<boolean> {
  const db = await getDb();
  const [job] = await db.select({ enrichment: schema.jobs.enrichment }).from(schema.jobs).where(eq(schema.jobs.id, jobId));
  const media = await db.select().from(schema.media).where(eq(schema.media.jobId, jobId));
  if (job?.enrichment && !media.some(needsScreening)) return false;
  await enrichJob(jobId);
  return true;
}
