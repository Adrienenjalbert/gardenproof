/**
 * Image preparation for vision calls + cheap deterministic quality metrics.
 * Uses the public derivative when present (blurred / EXIF-stripped) so the model never sees
 * more than the public will, and downsizes to keep token cost predictable.
 */
import sharp from "sharp";
import type { Media } from "@/db/schema";
import { getObject } from "@/lib/storage";

export type AiImage = { mediaId: string; stage: string; mediaType: "image/jpeg"; data: string };

export type ImageMetrics = {
  width: number;
  height: number;
  /** Mean luminance 0..1. Below ~0.22 reads as "too dark" on a phone. */
  brightness: number;
  /** sharp's Laplacian-based sharpness estimate; low values suggest blur. */
  sharpness: number;
};

const MAX_EDGE = 1024;

export async function prepareImage(m: Pick<Media, "id" | "stage" | "storageKey" | "publicKey">): Promise<{ image: AiImage; metrics: ImageMetrics } | null> {
  let buf: Buffer;
  try {
    buf = await getObject(m.publicKey ?? m.storageKey);
  } catch {
    return null; // missing file: enrichment continues with the remaining images
  }
  const resized = await sharp(buf)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { image: { mediaId: m.id, stage: m.stage, mediaType: "image/jpeg", data: resized.toString("base64") }, metrics: await imageMetrics(resized) };
}

export async function imageMetrics(buf: Buffer): Promise<ImageMetrics> {
  const img = sharp(buf);
  const [meta, stats] = await Promise.all([img.metadata(), img.stats()]);
  const [r, g, b] = stats.channels;
  const brightness = r && g && b ? (0.2126 * r.mean + 0.7152 * g.mean + 0.0722 * b.mean) / 255 : (stats.channels[0]?.mean ?? 128) / 255;
  return { width: meta.width ?? 0, height: meta.height ?? 0, brightness, sharpness: stats.sharpness };
}

export const DARK_THRESHOLD = 0.22;
export const BLUR_THRESHOLD = 1.2;

/** Metric-only quality score + notes (used by the mock and to sanity-check the model). */
export function metricQuality(m: ImageMetrics): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0.85;
  if (m.brightness < DARK_THRESHOLD) {
    notes.push("too dark");
    score = Math.min(score, 0.35);
  } else if (m.brightness > 0.9) {
    notes.push("overexposed");
    score = Math.min(score, 0.5);
  }
  // Darkening also lowers the sharpness estimate, so only judge blur on properly exposed images.
  if (m.brightness >= DARK_THRESHOLD && m.sharpness < BLUR_THRESHOLD) {
    notes.push("possibly blurry");
    score = Math.min(score, 0.45);
  }
  if (Math.max(m.width, m.height) < 600) {
    notes.push("low resolution");
    score = Math.min(score, 0.55);
  }
  return { score: Math.round(score * 100) / 100, notes };
}
