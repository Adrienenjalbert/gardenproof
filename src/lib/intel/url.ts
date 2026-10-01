/**
 * URL helpers for onboarding: normalising what an owner pastes, absolutising links against their site, and refusing
 * URLs that could point the server at private infrastructure (SSRF) before we fetch or ask Firecrawl to.
 */
import dns from "node:dns/promises";
import net from "node:net";

/** "thorburnlandscapes.co.uk" → "https://thorburnlandscapes.co.uk/". Null when it can't be a web address. */
export function normaliseSiteUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Host without "www." — the identity we compare sites by. */
export function bareHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Same site = same bare host, or a subdomain of it (cdn.example.co.uk). */
export function isSameSite(url: string, siteUrl: string): boolean {
  const a = bareHost(url);
  const b = bareHost(siteUrl);
  return Boolean(a && b && (a === b || a.endsWith(`.${b}`)));
}

const SAFE_HREF = /^(https?:|tel:|mailto:)/i;

/**
 * Resolve a link found on a page against the page URL. Only http(s)/tel/mailto survive: javascript:, data:,
 * vbscript: and anything unparseable become null. Control characters and whitespace (used to smuggle
 * "java\tscript:") are stripped first, the same way browsers do.
 */
export function absolutise(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  // Browsers drop tabs/newlines anywhere in a URL and C0 controls/spaces at both ends: do the same first.
  const cleaned = href.replace(/[\t\n\r]+/g, "").replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
  if (!cleaned || cleaned === "#") return null;
  if (/^(tel|mailto):/i.test(cleaned)) return cleaned.replace(/^(tel|mailto):\s*/i, (_m, s: string) => `${s.toLowerCase()}:`);
  try {
    const u = new URL(cleaned, base);
    if (!SAFE_HREF.test(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Canonical form for de-duplicating URLs: https, no www, no trailing slash, no hash, no tracking params. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|__d$|rwg_token)/i.test(p)) u.searchParams.delete(p);
    const host = u.hostname.toLowerCase().replace(/^(www|m|uk)\./, "");
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, "") || "/";
    return `${host}${path.toLowerCase()}${u.search}`;
  } catch {
    return url;
  }
}

function ipv4Private(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses (v4 and v6). */
export function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return ipv4Private(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return ipv4Private(mapped[1]);
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8");
  }
  return true;
}

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Gate for URLs the owner submits (and for images we download ourselves): https only, a real public hostname,
 * and every address it resolves to must be public. `lookup` is injectable for tests.
 */
export async function checkPublicHttpsUrl(
  input: string,
  lookup: (host: string) => Promise<string[]> = async (h) => (await dns.lookup(h, { all: true })).map((a) => a.address),
): Promise<UrlCheck> {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return { ok: false, reason: "That doesn't look like a web address." };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "Please use an https:// address." };
  if (u.username || u.password) return { ok: false, reason: "Web addresses with a login are not supported." };
  if (u.port && u.port !== "443") return { ok: false, reason: "Please use the normal web address of your site." };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return isPrivateIp(host) ? { ok: false, reason: "That address is not on the public internet." } : { ok: true, url: u.toString() };
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/i.test(host)) {
    return { ok: false, reason: "That address is not on the public internet." };
  }
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return { ok: false, reason: "We couldn't find that website. Check the address and try again." };
  }
  if (!addresses.length || addresses.some(isPrivateIp)) return { ok: false, reason: "That address is not on the public internet." };
  return { ok: true, url: u.toString() };
}
