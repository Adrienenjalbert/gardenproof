/**
 * Media storage, behind one small API. Two adapters:
 * - local disk (default): STORAGE_DIR or .data/storage. Fine for dev and a single container with a volume.
 * - Supabase Storage: selected when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_BUCKET are all set.
 *   The bucket must be PRIVATE: nothing is ever fetched from Supabase by browsers; every public byte goes
 *   through /api/media/<key>, which decides what may be served.
 * Renderers (Remotion, ffmpeg, sharp by path) need a real file: use `localObjectPath(key)`, which downloads
 * remote objects to a temp file.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "./config";

// turbopackIgnore: runtime storage dir must not be traced into the server bundle.
const root = () => process.env.STORAGE_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "storage");

export function safeKey(key: string): string {
  const normalised = path.posix.normalize(key).replace(/^\/+/, "");
  if (normalised.startsWith("..") || normalised === "." || normalised.includes("\0")) throw new Error(`Invalid storage key: ${key}`);
  return normalised;
}

interface StorageAdapter {
  readonly remote: boolean;
  put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

const localAdapter: StorageAdapter = {
  remote: false,
  async put(key, data) {
    const file = path.join(/*turbopackIgnore: true*/ root(), key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  },
  get: (key) => fs.readFile(path.join(/*turbopackIgnore: true*/ root(), key)),
  async exists(key) {
    try {
      await fs.access(path.join(/*turbopackIgnore: true*/ root(), key));
      return true;
    } catch {
      return false;
    }
  },
  async remove(key) {
    await fs.rm(path.join(/*turbopackIgnore: true*/ root(), key), { force: true });
  },
};

export type SupabaseStorageConfig = { url: string; serviceKey: string; bucket: string };

/** Supabase Storage over its REST API (no SDK): /storage/v1/object/<bucket>/<key>. */
export function supabaseAdapter(cfg: SupabaseStorageConfig, fetchImpl: typeof fetch = fetch): StorageAdapter {
  const base = `${cfg.url.replace(/\/$/, "")}/storage/v1/object`;
  const objectUrl = (key: string) => `${base}/${encodeURIComponent(cfg.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const headers = (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${cfg.serviceKey}`,
    apikey: cfg.serviceKey,
    ...extra,
  });
  const fail = async (res: Response, what: string) => {
    const detail = await res.text().catch(() => "");
    return new Error(`Supabase storage ${what} failed (${res.status}): ${detail.slice(0, 200)}`);
  };
  return {
    remote: true,
    async put(key, data, contentType) {
      const res = await fetchImpl(objectUrl(key), {
        method: "POST",
        headers: headers({ "content-type": contentType, "x-upsert": "true", "cache-control": "no-cache" }),
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw await fail(res, `upload of ${key}`);
    },
    async get(key) {
      const res = await fetchImpl(objectUrl(key), { headers: headers(), signal: AbortSignal.timeout(120_000) });
      if (res.status === 404 || res.status === 400) {
        // Supabase answers 400 {"error":"not_found"} for missing objects; normalise to ENOENT like the disk adapter.
        throw Object.assign(new Error(`Object not found: ${key}`), { code: "ENOENT" });
      }
      if (!res.ok) throw await fail(res, `download of ${key}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async exists(key) {
      const res = await fetchImpl(objectUrl(key), { method: "HEAD", headers: headers(), signal: AbortSignal.timeout(30_000) });
      return res.ok;
    },
    async remove(key) {
      const res = await fetchImpl(`${base}/${encodeURIComponent(cfg.bucket)}`, {
        method: "DELETE",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ prefixes: [key] }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw await fail(res, `delete of ${key}`);
    },
  };
}

export function supabaseConfig(vars: Record<string, string | undefined> = process.env): SupabaseStorageConfig | null {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey, SUPABASE_BUCKET: bucket } = vars;
  return url && serviceKey && bucket ? { url, serviceKey, bucket } : null;
}

// Read at call time so tests (and a late-loaded env) pick the right adapter.
function adapter(): StorageAdapter {
  const cfg = supabaseConfig();
  return cfg ? supabaseAdapter(cfg) : localAdapter;
}

export const isRemoteStorage = () => adapter().remote;

export async function putObject(key: string, data: Buffer | Uint8Array): Promise<string> {
  const k = safeKey(key);
  await adapter().put(k, data, mimeFromKey(k));
  return k;
}

export async function getObject(key: string): Promise<Buffer> {
  return adapter().get(safeKey(key));
}

export async function objectExists(key: string): Promise<boolean> {
  return adapter().exists(safeKey(key));
}

/** Delete an object (idempotent). Used when consent is withdrawn or a derivative is replaced. */
export async function deleteObject(key: string): Promise<void> {
  await adapter().remove(safeKey(key));
}

/**
 * Absolute filesystem path of a LOCAL-disk object. Synchronous, so it cannot download: with remote storage
 * it throws — use `localObjectPath` (async) in renderers.
 */
export function objectPath(key: string): string {
  if (adapter().remote) throw new Error("objectPath() is local-only; use await localObjectPath(key) with remote storage");
  return path.join(/*turbopackIgnore: true*/ root(), safeKey(key));
}

/**
 * A real file path for renderers (Remotion, sharp by path). Local disk: the file itself. Remote: downloaded
 * once per process into the OS temp dir (keys are immutable in practice: new versions get new keys).
 */
export async function localObjectPath(key: string): Promise<string> {
  const k = safeKey(key);
  const store = adapter();
  if (!store.remote) return path.join(/*turbopackIgnore: true*/ root(), k);
  const file = path.join(os.tmpdir(), "gardenproof-storage", k);
  try {
    await fs.access(file);
    return file;
  } catch {
    const data = await store.get(k);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.part`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
    return file;
  }
}

/** URL the browser (and WordPress) can fetch. */
export function publicUrl(key: string, absolute = false): string {
  const rel = `/api/media/${safeKey(key)}`;
  return absolute ? `${env.appUrl}${rel}` : rel;
}

export function mimeFromKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  return (
    {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".heic": "image/heic",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".ogg": "audio/ogg",
      ".mp3": "audio/mpeg",
      ".m4a": "audio/mp4",
      ".wav": "audio/wav",
      ".webm": "audio/webm",
      ".html": "text/html; charset=utf-8",
      ".json": "application/json",
      ".csv": "text/csv; charset=utf-8",
      ".txt": "text/plain; charset=utf-8",
      ".vcf": "text/vcard",
    }[ext] ?? "application/octet-stream"
  );
}
