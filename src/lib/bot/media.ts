/**
 * Media ingestion for crew uploads.
 * - Original kept privately, byte-for-byte:        private/<tenantSlug>/<jobId>/<stage>-<rand>.<ext>
 *   (EXIF/GPS intact; the "private/" prefix is never served publicly, and the random part is unguessable)
 * - Public-safe derivative for images (publicKey): <tenantSlug>/<jobId>/<stage>-<rand>.public.jpg
 *   auto-rotated, EXIF/GPS stripped (sharp drops metadata unless asked), max 2000px, JPEG q82.
 * Random names (not counters) mean concurrent uploads on several instances can never overwrite each other.
 * Audio/video are stored as-is; transcription happens in the content module (transcript stays null).
 */
import { nanoid } from "nanoid";
import sharp from "sharp";
import { getDb, schema } from "@/db";
import type { Media } from "@/db/schema";
import type { MediaKind, MediaStage } from "@/lib/domain";
import { newId } from "@/lib/ids";
import { putObject } from "@/lib/storage";

/** Storage prefix for originals; /api/media must never serve keys under it. */
export const PRIVATE_PREFIX = "private/";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
};

export function kindFromMime(mime: string): MediaKind | null {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("audio/")) return "audio";
  if (base.startsWith("video/")) return "video";
  return null;
}

export function extFromMime(mime: string): string {
  return EXT[mime.split(";")[0].trim().toLowerCase()] ?? "bin";
}

export const PUBLIC_MAX_PX = 2000;
export const PUBLIC_JPEG_QUALITY = 82;

/** Public-safe JPEG: rotate per EXIF, then re-encode without any metadata. */
export async function makePublicDerivative(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: PUBLIC_MAX_PX, height: PUBLIC_MAX_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: PUBLIC_JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function ingestMedia(input: {
  tenantId: string;
  tenantSlug: string;
  jobId: string;
  stage: MediaStage;
  data: Buffer;
  mimeType: string;
  sourceMessageId?: string | null;
}): Promise<Media> {
  const kind = kindFromMime(input.mimeType);
  if (!kind) throw new Error(`Unsupported media type: ${input.mimeType}`);
  const ext = extFromMime(input.mimeType);
  const name = `${input.stage}-${nanoid(12).replace(/[^A-Za-z0-9]/g, "x")}`;
  const base = `${input.tenantSlug}/${input.jobId}/${name}`;
  const storageKey = await putObject(`${PRIVATE_PREFIX}${base}.${ext}`, input.data);

  let publicKey: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  if (kind === "image") {
    try {
      const derivative = await makePublicDerivative(input.data);
      publicKey = await putObject(`${base}.public.jpg`, derivative.data);
      width = derivative.width;
      height = derivative.height;
    } catch (err) {
      // Unreadable image (e.g. HEIC without codec): keep the original; the dashboard flags missing publicKey.
      console.error("[media] derivative failed", storageKey, err);
    }
  }

  const db = await getDb();
  const [row] = await db
    .insert(schema.media)
    .values({
      id: newId("med"),
      tenantId: input.tenantId,
      jobId: input.jobId,
      stage: input.stage,
      kind,
      storageKey,
      publicKey,
      mimeType: input.mimeType.split(";")[0].trim(),
      width,
      height,
      sourceMessageId: input.sourceMessageId ?? null,
    })
    .returning();
  return row;
}
