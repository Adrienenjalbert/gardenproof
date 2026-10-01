/**
 * Phase 1 single-operator auth for the agency dashboard.
 *
 * A session is a signed, expiring token: `<expiresAtMs>.<base64url HMAC-SHA256>`. The HMAC key is the
 * ADMIN_PASSWORD itself and the signed message includes SESSION_VERSION, so rotating the password OR bumping
 * SESSION_VERSION revokes every existing cookie (there is no server-side session store in Phase 1).
 * Uses Web Crypto only, so the same code runs in proxy.ts, server actions and Vitest.
 */

export const SESSION_COOKIE = "gp_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/**
 * Paths that must stay reachable without a dashboard login: homeowner review links, the WhatsApp simulator,
 * public previews/portfolio, webhooks, lead capture, media and the portfolio export, plus the login page itself.
 */
const PUBLIC_PREFIXES = [
  "/r/",
  "/preview/",
  "/portfolio",
  "/f/",
  "/enquire/",
  "/api/whatsapp/",
  "/api/leads",
  "/api/media/",
  "/api/forms/",
  "/api/export/portfolio.json",
  "/api/cron/", // protected by CRON_SECRET instead
  "/login",
  "/_next/",
  "/demo/",
];
const PUBLIC_EXACT = new Set(["/favicon.ico", "/robots.txt", "/thorburn-logo.jpg", "/gp-track.js"]);

/** True when a path is public. Everything else (the dashboard) is private by default. */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => {
    if (p.endsWith("/")) return pathname.startsWith(p);
    // "/simulator" must match "/simulator" and "/simulator/x" but not "/simulatorx".
    return pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`);
  });
}

const enc = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return toBase64Url(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Length-safe constant-time string comparison (avoids timing leaks on signatures/passwords). */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Env-driven session version ("1" when unset). Bump it to sign every operator out. */
export function sessionVersion(): string {
  return process.env.SESSION_VERSION?.trim() || "1";
}

const sessionMessage = (exp: number, version: string) => `gp-session:v${version}:${exp}`;

export async function createSessionToken(secret: string, now = Date.now(), version = sessionVersion()): Promise<string> {
  const exp = now + SESSION_TTL_MS;
  return `${exp}.${await hmac(secret, sessionMessage(exp, version))}`;
}

export async function verifySessionToken(
  token: string | null | undefined,
  secret: string,
  now = Date.now(),
  version = sessionVersion(),
): Promise<boolean> {
  if (!token) return false;
  const [expRaw, sig, ...rest] = token.split(".");
  if (rest.length || !expRaw || !sig || !/^\d+$/.test(expRaw)) return false;
  const exp = Number(expRaw);
  if (exp <= now) return false;
  return safeEqual(sig, await hmac(secret, sessionMessage(exp, version)));
}

/** Compare a submitted password to the configured one via HMAC digests (constant time, any length). */
export async function passwordMatches(submitted: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmac("gp-login", submitted), hmac("gp-login", expected)]);
  return safeEqual(a, b);
}

/**
 * Only allow same-origin paths as the post-login redirect. Browsers and the Next router strip tabs/newlines
 * and treat a backslash like "/", so "/\t/evil.example" or "/%5C%5Cevil" would otherwise become "//evil.example".
 * We normalise first (decode, drop control characters, backslashes → slashes) and then require that resolving
 * the result against a dummy origin keeps that origin.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  let decoded = next;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return "/";
  }
  const normalised = decoded.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\\/g, "/").trim();
  if (!normalised.startsWith("/") || normalised.startsWith("//")) return "/";
  // Reject the raw value too if it carries characters the browser would strip or reinterpret.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return "/";
  const base = "http://gardenproof.invalid";
  let url: URL;
  try {
    url = new URL(normalised, base);
  } catch {
    return "/";
  }
  if (url.origin !== base) return "/";
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

// ---------------------------------------------------------------------------
// Auth mode
// ---------------------------------------------------------------------------

/**
 * How the dashboard is protected:
 * - "enforced": ADMIN_PASSWORD is set, sessions are required.
 * - "open": zero-config demo (local dev, tests, or DEMO_MODE=on explicitly) — no login.
 * - "misconfigured": a production build with no password and no explicit demo opt-in. We refuse to serve the
 *   dashboard rather than leave it (and every Server Action) open to the internet.
 */
export type AuthMode = "enforced" | "open" | "misconfigured";

export function authMode(e: { ADMIN_PASSWORD?: string; NODE_ENV?: string; DEMO_MODE?: string } = process.env): AuthMode {
  if (e.ADMIN_PASSWORD) return "enforced";
  if (e.NODE_ENV === "production" && e.DEMO_MODE !== "on") return "misconfigured";
  return "open";
}

export const MISCONFIGURED_MESSAGE =
  "The dashboard is not configured: set ADMIN_PASSWORD (or DEMO_MODE=on for a public demo) and redeploy.";
