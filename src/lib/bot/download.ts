/**
 * Inbound WhatsApp media download, locked down: the webhook hands us URLs from the request body, so this is
 * the server's one outbound fetch driven by third-party input (SSRF surface). Rules:
 * - https only, and only Twilio hosts (api.twilio.com, *.twilio.com, *.twiliocdn.com), checked on every redirect;
 * - Twilio basic auth is sent to api.twilio.com only, never to a redirect target;
 * - 15s timeout, 20MB cap (streamed, so a lying Content-Length can't blow memory), content-type allow-list.
 */
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const MEDIA_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/amr",
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "video/quicktime",
  "video/3gpp",
  "text/vcard",
  "text/x-vcard",
  "text/directory",
]);

export const baseMime = (mime: string) => mime.split(";")[0].trim().toLowerCase();
export const isVCardMime = (mime: string) => ["text/vcard", "text/x-vcard", "text/directory"].includes(baseMime(mime));

export function isAllowedMediaHost(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const h = u.hostname.toLowerCase();
  return h === "api.twilio.com" || h.endsWith(".twilio.com") || h.endsWith(".twiliocdn.com");
}

export class MediaDownloadError extends Error {}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new MediaDownloadError(`too large (${declared} bytes)`);
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new MediaDownloadError(`too large (> ${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function downloadInboundMedia(
  url: string,
  opts: { declaredType: string; authorization?: string; fetchImpl?: typeof fetch; maxBytes?: number; timeoutMs?: number },
): Promise<{ data: Buffer; mimeType: string }> {
  const declared = baseMime(opts.declaredType);
  if (!ALLOWED_MEDIA_TYPES.has(declared)) throw new MediaDownloadError(`type not allowed: ${declared}`);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? MEDIA_TIMEOUT_MS);

  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedMediaHost(current)) throw new MediaDownloadError(`host not allowed: ${current.slice(0, 80)}`);
    const headers: Record<string, string> = {};
    if (opts.authorization && new URL(current).hostname.toLowerCase() === "api.twilio.com") headers.authorization = opts.authorization;
    const res = await fetchImpl(current, { headers, redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new MediaDownloadError(`redirect without location (${res.status})`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new MediaDownloadError(`download failed (${res.status})`);
    const served = baseMime(res.headers.get("content-type") ?? declared);
    // Trust the served type only if it is itself allowed; generic octet-streams fall back to Twilio's declared type.
    const mimeType = ALLOWED_MEDIA_TYPES.has(served) ? served : served === "application/octet-stream" ? declared : null;
    if (!mimeType) throw new MediaDownloadError(`served type not allowed: ${served}`);
    return { data: await readCapped(res, opts.maxBytes ?? MEDIA_MAX_BYTES), mimeType };
  }
  throw new MediaDownloadError("too many redirects");
}
