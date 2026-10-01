/**
 * Twilio request validation (X-Twilio-Signature):
 * base64(HMAC-SHA1(authToken, fullUrl + concat(sorted(key + value)))).
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function twilioSignature(authToken: string, url: string, params: URLSearchParams): string {
  const keys = [...new Set(params.keys())].sort();
  let data = url;
  for (const k of keys) for (const v of params.getAll(k)) data += k + v;
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function isValidTwilioSignature(
  authToken: string,
  signature: string | null,
  urls: string[],
  params: URLSearchParams,
): boolean {
  if (!signature) return false;
  const given = Buffer.from(signature);
  return urls.some((url) => {
    const expected = Buffer.from(twilioSignature(authToken, url, params));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

/** Behind a proxy the URL Twilio signed differs from req.url; try the plausible public URLs. */
export function candidateUrls(req: Request, appUrl: string): string[] {
  const u = new URL(req.url);
  const out = new Set<string>([req.url, `${appUrl.replace(/\/$/, "")}${u.pathname}${u.search}`]);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) out.add(`${req.headers.get("x-forwarded-proto") ?? "https"}://${host}${u.pathname}${u.search}`);
  return [...out];
}
