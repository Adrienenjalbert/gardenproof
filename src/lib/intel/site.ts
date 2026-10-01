/**
 * Reading the business's own website: choosing which pages matter, and pulling facts out of them.
 * Deterministic parsing first (tel:/mailto: links, postcodes, menus, URLs); Firecrawl's JSON extraction fills the
 * prose fields (tagline, about, years trading). Every extracted contact detail must appear on the site's pages.
 */
import { z } from "zod";
import { findAll, parseHtml, textOf } from "./html";
import { socialNetworkOf } from "./providers";
import type { NavItem } from "./shell";
import { collapse, findEmails, findPhones, findPostcodes, labelFromSlug, normalisePhone, slugify } from "./text";
import { absolutise, canonicalUrl, isSameSite } from "./url";

export type PageKind = "about" | "contact" | "services" | "service" | "portfolio_index" | "portfolio_item" | "locations" | "location";

const PATTERNS: [PageKind, RegExp][] = [
  ["portfolio_item", /^\/(portfolio|projects?|our-work|case-stud(y|ies)|work|gallery)\/(?!(page|category|tag)\b)[^/]+\/?$/i],
  ["portfolio_index", /^\/(portfolio|projects?|our-projects|our-work|case-studies|gallery(-\d+)?|our-gallery|photo-gallery)\/?$/i],
  ["service", /^\/(services?|what-we-do)\/(?!(page|category)\b)[^/]+\/?$/i],
  ["services", /^\/(services|all-services|what-we-do|our-services)\/?$/i],
  ["location", /^\/(locations?|areas?(-we-cover)?|areas-covered)\/[^/]+\/?$/i],
  ["locations", /^\/(locations?|areas?(-we-cover)?|areas-covered|where-we-work)\/?$/i],
  ["about", /^\/(about(-us)?|our-story|who-we-are|our-team)\/?$/i],
  ["contact", /^\/(contact(-us)?|get-in-touch|enquir(e|y|ies)|get-a-quote)\/?$/i],
];

export function classifyPage(url: string): PageKind | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  for (const [kind, re] of PATTERNS) if (re.test(path)) return kind;
  return null;
}

export type KeyPages = Record<PageKind, string[]>;

/** Group the site's URLs by kind (same site only, de-duplicated, stable order). */
export function pickKeyPages(urls: string[], siteUrl: string): KeyPages {
  const out = { about: [], contact: [], services: [], service: [], portfolio_index: [], portfolio_item: [], locations: [], location: [] } as KeyPages;
  const seen = new Set<string>();
  for (const u of urls) {
    if (!isSameSite(u, siteUrl) || /\.(jpe?g|png|webp|pdf|xml)(\?|$)/i.test(u)) continue;
    const key = canonicalUrl(u);
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = classifyPage(u);
    if (kind) out[kind].push(u);
  }
  return out;
}

/** Services from the menu ("Services" dropdown) or from /service/<slug> pages. */
export function servicesFrom(nav: NavItem[], serviceUrls: string[]): { key: string; label: string; url: string | null }[] {
  const out = new Map<string, { key: string; label: string; url: string | null }>();
  const parent = nav.find((n) => /services?|what we do/i.test(n.label) && n.children.length);
  for (const c of parent?.children ?? []) {
    const key = slugify(c.label).replace(/-/g, "_");
    out.set(key, { key, label: c.label, url: c.href });
  }
  // The menu is the business's own curated list; URL slugs are a fallback (sites keep test/SEO pages around).
  if (out.size) return [...out.values()].slice(0, 12);
  for (const u of serviceUrls) {
    const slug = new URL(u).pathname.split("/").filter(Boolean).pop() ?? "";
    const label = labelFromSlug(slug);
    if (/\btest\b|case stud|sample|demo/i.test(label)) continue;
    const key = slugify(label).replace(/-/g, "_");
    const existing = out.get(key);
    if (existing) existing.url = existing.url ?? u;
    else out.set(key, { key, label, url: u });
  }
  return [...out.values()].slice(0, 12);
}

const TRADE_WORDS = /\b(garden|gardens|gardening|landscaping|landscapers?|landscape|design|services?|and|office|maintenance|build|contractors?|in|near|me)\b/gi;

/** "…/locations/clapham-landscaping-and-garden-design" → "Clapham". Null when nothing place-like remains. */
export function areaNameFromUrl(url: string): string | null {
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  const words = decodeURIComponent(slug).replace(/[-_]+/g, " ").replace(TRADE_WORDS, " ").replace(/\s+/g, " ").trim();
  if (!words || words.length > 30 || /\d/.test(words)) return null;
  return words.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bUpon\b/g, "upon");
}

export function socialLinks(links: string[]): { network: string; url: string }[] {
  const out = new Map<string, string>();
  for (const l of links) {
    const net = socialNetworkOf(l);
    if (!net || out.has(net) || /sharer|share\?|intent\/tweet|\/hashtag\//i.test(l)) continue;
    out.set(net, l);
  }
  return [...out].map(([network, url]) => ({ network, url }));
}

/** Contact details that appear on the site: tel:/mailto: links first (deliberate), then text. */
export function contactFacts(pages: { rawHtml?: string; markdown?: string; url: string }[], siteUrl: string) {
  const phones = new Map<string, number>();
  const emails = new Map<string, number>();
  const postcodes = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
  const host = new URL(siteUrl).hostname.replace(/^www\./, "");
  for (const p of pages) {
    if (p.rawHtml) {
      const root = parseHtml(p.rawHtml);
      for (const a of findAll(root, (e) => e.tag === "a" && Boolean(e.attrs.href))) {
        const href = absolutise(a.attrs.href, p.url) ?? "";
        if (href.startsWith("tel:")) {
          const ph = normalisePhone(href.slice(4));
          if (ph) bump(phones, ph, 3);
        } else if (href.startsWith("mailto:")) {
          const em = href.slice(7).split("?")[0].trim().toLowerCase();
          if (em.includes("@")) bump(emails, em, 3);
        }
      }
    }
    const text = p.markdown ?? (p.rawHtml ? textOf(parseHtml(p.rawHtml)) : "");
    for (const ph of findPhones(text)) bump(phones, ph);
    for (const em of findEmails(text)) bump(emails, em, em.endsWith(host) ? 2 : 1);
    for (const pc of findPostcodes(text)) bump(postcodes, pc);
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { phones: top(phones), emails: top(emails), postcodes: top(postcodes) };
}

/** First substantial paragraphs of an About page (markdown), skipping menus, headings and link lists. */
export function aboutFromMarkdown(md: string, maxChars = 900): string | null {
  const paras = md
    .split(/\n{2,}/)
    .map((p) => collapse(p.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_#>]+/g, "")))
    .filter((p) => p.length >= 120 && !/^[-•]/.test(p) && !/cookie|javascript|©/i.test(p));
  if (!paras.length) return null;
  let out = "";
  for (const p of paras) {
    if (out.length + p.length > maxChars && out) break;
    out += (out ? "\n\n" : "") + p;
  }
  return out || null;
}

/** "With over 14 years of experience" / "Established in 2011" / "since 2011" → years trading. */
export function yearsTradingFrom(text: string, now = new Date()): number | null {
  const over = /(?:over|more than|nearly|almost)?\s*(\d{1,2})\+?\s*years?(?:'|’)?\s+(?:of\s+)?(?:experience|in business|trading|in the industry)/i.exec(text);
  if (over) return parseInt(over[1], 10);
  const est = /(?:established|founded|since|trading since|est\.?)\s*(?:in\s*)?((?:19|20)\d{2})/i.exec(text);
  if (est) {
    const y = parseInt(est[1], 10);
    if (y > 1900 && y <= now.getFullYear()) return now.getFullYear() - y;
  }
  return null;
}

/** Firecrawl JSON extraction schema for the homepage (their LLM reads the page; we verify what matters). */
export const SITE_FACTS_SCHEMA = z.object({
  businessName: z.string().nullable().optional(),
  legalName: z.string().nullable().optional(),
  tagline: z.string().nullable().optional(),
  about: z.string().nullable().optional(),
  yearsTrading: z.number().nullable().optional(),
  establishedYear: z.number().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  postcode: z.string().nullable().optional(),
  areasCovered: z.array(z.string()).nullable().optional(),
  services: z.array(z.string()).nullable().optional(),
  accreditations: z.array(z.string()).nullable().optional(),
  companyNumber: z.string().nullable().optional(),
});
export type SiteFacts = z.infer<typeof SITE_FACTS_SCHEMA>;

export const SITE_FACTS_PROMPT =
  "Extract facts about the business that owns this website, exactly as stated on the page. Do not guess or invent. " +
  "businessName: trading name. legalName: registered name if shown (e.g. ending Ltd/Limited). tagline: the short headline or slogan. " +
  "about: 2-3 sentences describing the business in its own words. yearsTrading: number if the page states years of experience. " +
  "establishedYear: year founded if stated. phone, email, address, postcode: main contact details. areasCovered: towns/areas they say they cover. " +
  "services: main services offered. accreditations: trade bodies, memberships or schemes mentioned (e.g. Which? Trusted Trader, TrustMark, APL). " +
  "companyNumber: UK company registration number if shown. Use null when not stated.";

export const SITE_FACTS_JSON_SCHEMA = z.toJSONSchema(SITE_FACTS_SCHEMA) as Record<string, unknown>;
