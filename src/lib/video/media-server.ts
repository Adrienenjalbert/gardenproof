/**
 * Tiny read-only static server so headless Chromium can load job photos.
 *
 * Why not file:// ? Remotion renders pages served from http://localhost, and Chromium refuses
 * file:// sub-resources from an http origin. Why not data: URIs ? They are serialised into the
 * input props of every render page (multi-MB per photo) and slow every frame. Why not the bundle's
 * public dir ? It is copied once at bundle time, so photos uploaded later would be missing.
 * A loopback server over the storage root + /public is zero-copy and always current.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { mimeFromKey, objectPath } from "@/lib/storage";

type Server = { baseUrl: string; close: () => Promise<void> };

const g = globalThis as unknown as { __gpVideoMediaServer?: Promise<Server> };

const publicRoot = () => path.join(process.cwd(), "public");

/** Map a URL path ("/storage/<key>" | "/public/<path>") to a file on disk, or null. */
export function fileForRequestPath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "");
  const m = decoded.match(/^\/(storage|public)\/(.+)$/);
  if (!m) return null;
  const rel = path.posix.normalize(m[2]!);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (m[1] === "storage") return objectPath(rel);
  const file = path.join(publicRoot(), rel);
  return file.startsWith(publicRoot() + path.sep) ? file : null;
}

async function start(): Promise<Server> {
  const server = http.createServer((req, res) => {
    const file = fileForRequestPath(req.url ?? "/");
    if (!file || !fs.existsSync(/*turbopackIgnore: true*/ file) || !fs.statSync(/*turbopackIgnore: true*/ file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": mimeFromKey(file),
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    fs.createReadStream(/*turbopackIgnore: true*/ file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref(); // never keep the process alive on its own
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function getMediaServer(): Promise<Server> {
  if (!g.__gpVideoMediaServer) g.__gpVideoMediaServer = start();
  return g.__gpVideoMediaServer;
}
