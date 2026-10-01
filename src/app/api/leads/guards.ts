/** CORS allow-list and a small in-memory rate limiter for the public lead endpoint. */
import type { TenantConfig } from "@/lib/tenant";

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Tenant website (with and without www), its WordPress host, and the app itself. */
export function allowedOrigins(config: TenantConfig, appUrl: string): Set<string> {
  const origins = new Set<string>();
  for (const url of [config.website, config.wordpress?.baseUrl, appUrl]) {
    const o = originOf(url);
    if (!o) continue;
    origins.add(o);
    const u = new URL(o);
    u.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
    origins.add(u.origin);
  }
  return origins;
}

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function isAllowedOrigin(origin: string | null, allowed: Set<string>): boolean {
  if (!origin) return true; // not a browser cross-site request (curl, server-to-server)
  return allowed.has(origin) || LOCALHOST.test(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * Fixed-window-ish limiter: `limit` hits per `windowMs` per key. In-memory, so per server instance —
 * enough to blunt form spam in Phase 1; move to Redis/Upstash when running more than one instance.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return function check(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - recent[0])) / 1000) };
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10_000) {
      for (const [k, ts] of hits) if (!ts.some((t) => now - t < windowMs)) hits.delete(k);
    }
    return { ok: true, retryAfterSec: 0 };
  };
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
