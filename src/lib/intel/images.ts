/**
 * Image downloads for onboarding: fetch (public hosts only, size-capped), normalise with sharp and store under
 * `intel/<slug>/…`. Photos become JPEG ≤ 1600px; logos and badges keep transparency as PNG ≤ 600px.
 * Also: a perceptual fingerprint (dHash) used to recognise accreditation logos that have no alt text.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { putObject } from "@/lib/storage";
import { checkPublicHttpsUrl } from "./url";

const MAX_BYTES = 15 * 1024 * 1024;

export type Downloader = (url: string) => Promise<Buffer | null>;

/**
 * Downloader for public images: https only (http is upgraded), public IPs only, size-capped, retried, paced per host
 * (small WordPress sites rate-limit bursts), and cached on disk so re-running an onboarding doesn't re-fetch.
 */
export function createDownloader(opts: { cacheDir?: string | null; fresh?: boolean; minGapMs?: number } = {}): Downloader {
  const lastHit = new Map<string, number>();
  const gap = opts.minGapMs ?? 350;
  const cacheFile = (url: string) => (opts.cacheDir ? path.join(opts.cacheDir, `${crypto.createHash("sha256").update(url).digest("hex").slice(0, 32)}.bin`) : null);

  async function fetchOnce(url: string): Promise<Buffer | "retry" | null> {
    const host = new URL(url).hostname;
    const wait = (lastHit.get(host) ?? 0) + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastHit.set(host, Date.now());
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "user-agent": "Mozilla/5.0 (compatible; GardenProofBot/1.0; +onboarding)", accept: "image/*" }, redirect: "follow" });
      // 403 is how WAFs (Wordfence, Cloudflare) answer a burst; worth one slower retry like 429/5xx.
      if (res.status === 429 || res.status === 403 || res.status >= 500) {
        if (process.env.INTEL_DEBUG) console.error("[intel] download", url, res.status);
        return "retry";
      }
      if (!res.ok) return null;
      const type = res.headers.get("content-type") ?? "";
      if (type && !type.startsWith("image/")) return null;
      if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > MAX_BYTES ? null : buf;
    } catch (err) {
      if (process.env.INTEL_DEBUG) console.error("[intel] download", url, (err as Error).message, (err as { cause?: unknown }).cause);
      return "retry";
    }
  }

  return async (url) => {
    const safe = await checkPublicHttpsUrl(url.replace(/^http:\/\//i, "https://"));
    if (!safe.ok) return null;
    const file = cacheFile(safe.url);
    if (file && !opts.fresh) {
      const hit = await fs.readFile(file).catch(() => null);
      if (hit) return hit;
    }
    for (let attempt = 1; attempt <= 4; attempt++) {
      const got = await fetchOnce(safe.url);
      if (got === null) return null;
      if (got !== "retry") {
        if (file) await fs.mkdir(path.dirname(file), { recursive: true }).then(() => fs.writeFile(file, got)).catch(() => undefined);
        return got;
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt * attempt));
    }
    return null;
  };
}

export const downloadImage: Downloader = createDownloader();

export type StoredImage = { key: string; width: number; height: number; bytes: number };

const shortHash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

/** Resize a photo to ≤ maxPx on the long edge, JPEG, EXIF stripped (sharp drops metadata by default). */
export async function storePhoto(buf: Buffer, keyPrefix: string, sourceUrl: string, maxPx = 1600): Promise<StoredImage | null> {
  try {
    const out = await sharp(buf, { failOn: "none" })
      .rotate()
      .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const key = await putObject(`${keyPrefix}/${shortHash(sourceUrl)}.jpg`, out.data);
    return { key, width: out.info.width, height: out.info.height, bytes: out.data.length };
  } catch {
    return null;
  }
}

/** Logos/badges: keep alpha, PNG, ≤ maxPx. */
export async function storeGraphic(buf: Buffer, key: string, maxPx = 600): Promise<StoredImage | null> {
  try {
    const out = await sharp(buf, { failOn: "none" })
      .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    const stored = await putObject(key.replace(/\.[a-z0-9]+$/i, "") + ".png", out.data);
    return { key: stored, width: out.info.width, height: out.info.height, bytes: out.data.length };
  } catch {
    return null;
  }
}

export async function imageSize(buf: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const m = await sharp(buf, { failOn: "none" }).metadata();
    return m.width && m.height ? { width: m.width, height: m.height } : null;
  } catch {
    return null;
  }
}

/**
 * 64-bit difference hash of a logo, after flattening onto white and trimming the empty margin, so the same logo
 * at different sizes/paddings hashes (nearly) the same. Returned as 16 hex chars.
 */
export async function logoFingerprint(buf: Buffer): Promise<string | null> {
  try {
    const flat = await sharp(buf, { failOn: "none" }).flatten({ background: "#ffffff" }).toBuffer();
    const trimmed = await sharp(flat).trim({ threshold: 20 }).toBuffer().catch(() => flat);
    const { data } = await sharp(trimmed).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? "1" : "0";
    return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
  } catch {
    return null;
  }
}

export function hammingHex(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & BigInt(1));
    x >>= BigInt(1);
  }
  return n;
}

/**
 * WordPress & co. serve resized copies ("photo-640x450.jpg"). The original is usually the same name without the
 * size suffix; try it first for the largest real photo.
 */
export function originalImageCandidates(url: string): string[] {
  const m = /^(.*?)-(\d{2,4})x(\d{2,4})(\.[a-z0-9]+)(\?.*)?$/i.exec(url);
  return m ? [`${m[1]}${m[4]}`, url] : [url];
}
