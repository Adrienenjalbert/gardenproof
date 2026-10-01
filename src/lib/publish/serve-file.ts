/**
 * Streams a stored object as an HTTP response with byte-range support.
 *
 * iOS Safari refuses to play an MP4 unless the server answers `Range` requests with 206, and seeking needs it
 * everywhere. Files are streamed from disk, never buffered whole (videos are several MB).
 */
import fs from "node:fs";
import { Readable } from "node:stream";
import { mimeFromKey, objectPath } from "@/lib/storage";

export type ByteRange = { start: number; end: number };

/**
 * Parse a single `bytes=` range against a file size.
 * - null: no usable Range header (absent, another unit, or several ranges) → serve the whole file (200).
 * - "unsatisfiable": malformed or out of bounds → 416.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(.+)$/i.exec(header);
  if (!m) return null;
  const specs = m[1].split(",");
  if (specs.length > 1) return null; // multipart/byteranges is not worth it for media: send the whole file
  const r = /^\s*(\d*)\s*-\s*(\d*)\s*$/.exec(specs[0]);
  if (!r || (!r[1] && !r[2])) return "unsatisfiable";
  if (!r[1]) {
    // Suffix range: the last N bytes.
    const n = Number(r[2]);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(r[1]);
  const end = r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
  if (start >= size || (r[2] && Number(r[2]) < start)) return "unsatisfiable";
  return { start, end };
}

export type ServeOptions = {
  headers?: Record<string, string>;
  contentType?: string;
  method?: string;
};

export async function serveStoredFile(key: string, req: Request, opts: ServeOptions = {}): Promise<Response> {
  let file: string;
  let size: number;
  let mtime: Date;
  try {
    file = objectPath(key);
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
    mtime = stat.mtime;
  } catch {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  }

  const base: Record<string, string> = {
    "content-type": opts.contentType ?? mimeFromKey(key),
    "accept-ranges": "bytes",
    "last-modified": mtime.toUTCString(),
    "x-content-type-options": "nosniff",
    // Stored files are never pages: if one is opened directly it gets no script or same-origin access.
    "content-security-policy": "sandbox",
    ...opts.headers,
  };
  const head = (opts.method ?? req.method) === "HEAD";
  const range = parseRange(req.headers.get("range"), size);

  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const length = size === 0 ? 0 : end - start + 1;
  const headers = {
    ...base,
    "content-length": String(length),
    ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
  };
  const status = range ? 206 : 200;
  if (head || length === 0) return new Response(null, { status, headers });

  const stream = fs.createReadStream(file, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
}
