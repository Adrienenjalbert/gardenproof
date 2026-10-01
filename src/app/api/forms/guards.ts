/**
 * Guards shared by the smart-form API: same-origin (CSRF), per token+IP rate limits, JSON body parsing and
 * FormError -> HTTP mapping. The token in the path is the only credential and scopes every call to one form.
 */
import { z } from "zod";
import { env } from "@/lib/config";
import { FormError, type FormErrorCode } from "@/lib/forms";
import { clientIp, createRateLimiter } from "../leads/guards";

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Origins the form page itself can be served from (the app URL and the host this request came in on). */
function ownOrigins(req: Request): Set<string> {
  const set = new Set<string>();
  for (const o of [originOf(req.url), originOf(env.appUrl)]) if (o) set.add(o);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
    set.add(`${proto}://${host}`);
  }
  return set;
}

/**
 * CSRF: browsers always send Origin on cross-origin POSTs (and Sec-Fetch-Site on modern ones). Requests
 * without either are not from a browser page (curl, server-to-server) and still need the unguessable token.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) return ownOrigins(req).has(origin);
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

const limiters = {
  answer: createRateLimiter({ limit: 120, windowMs: 10 * 60_000 }),
  complete: createRateLimiter({ limit: 10, windowMs: 10 * 60_000 }),
  upload: createRateLimiter({ limit: 30, windowMs: 10 * 60_000 }),
  postcode: createRateLimiter({ limit: 60, windowMs: 10 * 60_000 }),
  photo: createRateLimiter({ limit: 300, windowMs: 10 * 60_000 }),
};

export const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/** Returns an error response when the request must be refused, else null. */
export function guard(req: Request, token: string, kind: keyof typeof limiters, opts: { csrf?: boolean } = {}): Response | null {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return json(404, { ok: false, error: "This link doesn't look right" });
  if (opts.csrf !== false && !isSameOrigin(req)) return json(403, { ok: false, error: "Cross-site request refused" });
  const limited = limiters[kind](`${token}:${clientIp(req.headers)}`);
  if (!limited.ok) return json(429, { ok: false, error: "Too many requests, please wait a moment" }, { "Retry-After": String(limited.retryAfterSec) });
  return null;
}

/** Parse a small JSON body against a schema. Requires application/json (forces a CORS preflight cross-site). */
export async function readJson<T>(req: Request, schema: z.ZodType<T>, maxBytes = 32 * 1024): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { ok: false, res: json(415, { ok: false, error: "Send JSON" }) };
  }
  const raw = await req.text();
  if (raw.length > maxBytes) return { ok: false, res: json(413, { ok: false, error: "Too large" }) };
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, res: json(400, { ok: false, error: "Body must be JSON" }) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, res: json(400, { ok: false, error: "Invalid request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }) };
  return { ok: true, data: parsed.data };
}

const STATUS: Record<FormErrorCode, number> = { not_found: 404, completed: 409, invalid: 422, unknown_step: 422, incomplete: 422, unsupported: 400 };

export function formErrorResponse(err: unknown): Response {
  if (err instanceof FormError) return json(STATUS[err.code], { ok: false, code: err.code, error: err.message, ...err.details });
  console.error("[forms api]", err);
  return json(500, { ok: false, error: "Something went wrong. Your answers are saved, please try again." });
}
