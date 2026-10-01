/**
 * Reviews and listings on the public web: search, recognise the provider, entity-match, then read the matched
 * profile pages. Numbers and quotes are only kept when they can be found on the page itself (Firecrawl's LLM
 * extraction is checked against the page markdown), so nothing is ever invented.
 */
import { z } from "zod";
import type { BodyListing, ThirdPartyClaim } from "./badges";
import { matchEntity, splitTitle, type BusinessIdentity, type Candidate, type MatchResult } from "./entity";
import type { Firecrawl, ScrapeResult, SearchResult } from "./firecrawl";
import { BADGE_NAMES, badgeBodiesIn, detectProvider, type ProviderInfo } from "./providers";
import { normaliseRating, parseReviewDate } from "./ratings";
import { collapse, looseKey } from "./text";
import type { PublicReview, ReviewProvider, ReviewSource } from "./types";
import { canonicalUrl, isSameSite } from "./url";

export type SearchHit = SearchResult & { queries: string[] };

export function buildQueries(name: string, town: string | null): string[] {
  const q = [
    `${name} reviews`,
    town ? `${name} ${town}` : `${name} UK`,
    `${name} Which? Trusted Trader`,
    `${name} Checkatrade`,
    `${name} TrustMark`,
    `${name} Trustpilot`,
    `${name} Houzz`,
    `${name} Google reviews`,
    `${name} Companies House`,
    `${name} Facebook`,
    `${name} APL landscaper member`,
    `${name} HTA BALI member`,
  ];
  return [...new Set(q)];
}

/** Run searches, merging results by canonical URL (a page found by several queries keeps every snippet). */
export async function searchAll(fc: Firecrawl, queries: string[], limit = 8): Promise<{ hits: SearchHit[]; failed: string[] }> {
  const byUrl = new Map<string, SearchHit>();
  const failed: string[] = [];
  for (const query of queries) {
    try {
      for (const r of await fc.search({ query, limit })) {
        const key = canonicalUrl(r.url);
        const prev = byUrl.get(key);
        if (prev) {
          prev.queries.push(query);
          if (r.description && !(prev.description ?? "").includes(r.description)) prev.description = `${prev.description ?? ""} … ${r.description}`;
        } else byUrl.set(key, { ...r, queries: [query] });
      }
    } catch {
      failed.push(query);
    }
  }
  return { hits: [...byUrl.values()], failed };
}

/** Google-style rich snippet: "Rating 5.0(9)", "Rating 10/10(74)", "Rating 4.9 (44)". */
export function ratingFromSnippet(text: string | undefined): { rating: number | null; count: number | null } | null {
  const m = /Rating\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?\s*\((\d[\d,]*)\)/i.exec(text ?? "");
  if (!m) return null;
  return { rating: normaliseRating(parseFloat(m[1]), m[2] ? parseInt(m[2], 10) : null), count: parseInt(m[3].replace(/,/g, ""), 10) };
}

// ── provider page extraction ─────────────────────────────────────────────────────────────────────────────────

export const PROVIDER_PAGE_SCHEMA = z.object({
  businessName: z.string().nullable().optional(),
  overallRating: z.number().nullable().optional(),
  ratingOutOf: z.number().nullable().optional(),
  reviewCount: z.number().nullable().optional(),
  reviews: z
    .array(
      z.object({
        author: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        text: z.string(),
        rating: z.number().nullable().optional(),
        ratingOutOf: z.number().nullable().optional(),
        date: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
});
export type ProviderPageFacts = z.infer<typeof PROVIDER_PAGE_SCHEMA>;

export const PROVIDER_PAGE_PROMPT =
  "This is a business's profile page on a review or trade directory site. Extract ONLY what is visibly on the page, never guess. " +
  "overallRating: the business's overall/average rating as shown (null if the page says no overall rating is available). ratingOutOf: the scale (5 or 10). " +
  "reviewCount: total number of reviews stated. reviews: up to 8 of the most recent customer reviews, with author exactly as displayed " +
  "(e.g. 'Customer in Greater London' or 'Verified reviewer'), the review title, the full review text copied verbatim, its rating and scale if shown, and the date as shown.";

const PROVIDER_JSON_SCHEMA = z.toJSONSchema(PROVIDER_PAGE_SCHEMA) as Record<string, unknown>;

/** Scale each provider rates on (when the page doesn't say). */
const SCALE: Partial<Record<ReviewProvider, number>> = { checkatrade: 10 };

const numberOnPage = (md: string, n: number) => {
  const forms = new Set([String(n), n.toFixed(1), n.toFixed(2).replace(/0$/, "")]);
  return [...forms].some((f) => new RegExp(`(^|[^\\d.])${f.replace(".", "\\.")}([^\\d]|$)`).test(md));
};

/**
 * Keep only facts that the page markdown actually contains: rating and count must appear as numbers, and each
 * review's opening words must appear verbatim (modulo punctuation). Returns rating normalised to /5.
 */
export function verifyProviderFacts(facts: ProviderPageFacts | null, markdown: string, provider: ReviewProvider, url: string): { rating: number | null; count: number | null; reviews: PublicReview[] } {
  if (!facts) return { rating: null, count: null, reviews: [] };
  const scale = facts.ratingOutOf ?? SCALE[provider] ?? null;
  const rating = facts.overallRating != null && numberOnPage(markdown, facts.overallRating) ? normaliseRating(facts.overallRating, scale) : null;
  const count = facts.reviewCount != null && Number.isInteger(facts.reviewCount) && numberOnPage(markdown, facts.reviewCount) ? facts.reviewCount : null;
  const page = looseKey(markdown);
  const reviews: PublicReview[] = [];
  for (const r of facts.reviews ?? []) {
    const text = collapse(r.text ?? "");
    const probe = looseKey(text).slice(0, 80);
    if (text.length < 20 || !probe || !page.includes(probe)) continue;
    const rScale = r.ratingOutOf ?? SCALE[provider] ?? null;
    const author = r.author && page.includes(looseKey(r.author)) ? collapse(r.author) : null;
    reviews.push({
      provider,
      author,
      text: text.replace(/\s*(read more|read less)\s*/gi, " ").trim(),
      rating: r.rating != null && numberOnPage(markdown, r.rating) ? normaliseRating(r.rating, rScale) : null,
      date: parseReviewDate(r.date ?? null),
      url,
    });
  }
  return { rating, count, reviews };
}

/** The business name a profile page shows: its first H1 in markdown, else the title. */
export function pageName(md: string, title: string | undefined): string | null {
  const h1 = /(?:^|\n)#\s+\**([^\n*]{2,120})\**/.exec(md);
  const name = h1?.[1] ? h1[1].replace(/\s+\(?(?:SC|NI|OC)?\d{6,8}\)?$/i, "") : title ? splitTitle(title).name : "";
  return collapse(name) || null;
}

// ── body pages ───────────────────────────────────────────────────────────────────────────────────────────────

/** TrustMark names the scheme provider(s) a business is registered through (e.g. APL) — evidence of membership. */
export function trustmarkSchemeBodies(md: string): { bodies: ReturnType<typeof badgeBodiesIn>; licence: string | null } {
  const section = /Scheme Provider\(s\)([\s\S]{0,600})/i.exec(md)?.[1] ?? "";
  const licence = /Licence number[\s\S]{0,200}?(\d{5,8})/i.exec(md)?.[1] ?? null;
  return { bodies: badgeBodiesIn(section).filter((b) => b !== "trustmark"), licence };
}

export type CompanyInfo = { number: string; legalName: string; status: string | null; incorporated: string | null; url: string };

export function companiesHouseFacts(md: string, url: string): CompanyInfo | null {
  const name = /(?:^|\n)#\s+([^\n]+)/.exec(md)?.[1]?.trim();
  const number = /Company number\s*\**\s*([A-Z0-9]{8})/i.exec(md)?.[1] ?? /\/company\/([A-Z0-9]{8})/i.exec(url)?.[1];
  if (!name || !number) return null;
  const status = /Company status\s*\n+\s*([A-Za-z ]+)/i.exec(md)?.[1]?.trim() ?? null;
  const inc = /Incorporated on\s*(\d{1,2} \w+ \d{4})/i.exec(md)?.[1] ?? null;
  const legalName = name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bLtd\b/i, "Ltd");
  return { number: number.toUpperCase(), legalName, status, incorporated: parseReviewDate(inc), url };
}

/** Google Maps place/search page (markdown): name, rating, optional count. */
export function googleMapsFacts(md: string): { name: string | null; rating: number | null; count: number | null } {
  const name = pageName(md, undefined);
  const after = name ? md.slice(md.indexOf(name) + name.length, md.indexOf(name) + name.length + 400) : "";
  const r = /(?:^|\n)\s*([1-5][.,]\d)\s*(?:\(\s*\d[\d,]*\s*\))?\s*(?:\n|$)/.exec(after);
  const c = /\(\s*(\d[\d,]*)\s*\)|(\d[\d,]*)\s+(?:Google\s+)?reviews?/i.exec(after);
  return { name, rating: r ? normaliseRating(parseFloat(r[1].replace(",", ".")), 5) : null, count: c ? parseInt((c[1] ?? c[2]).replace(/,/g, ""), 10) : null };
}

// ── orchestration ────────────────────────────────────────────────────────────────────────────────────────────

export type ReviewsOutcome = {
  sources: ReviewSource[];
  reviews: PublicReview[];
  listings: BodyListing[];
  thirdParty: ThirdPartyClaim[];
  company: CompanyInfo | null;
  rejected: { url: string; reason: string }[];
  social: { network: string; url: string }[];
  warnings: string[];
};

const confidenceOf = (m: MatchResult) => m.confidence;

const profileKey = (u: string) => canonicalUrl(u).split("?")[0];

/** Raise confidence of listings/sources that a strongly matched page links to. */
function confirmLinkedProfiles(out: ReviewsOutcome, links: string[]): void {
  const linked = new Set(links.map(profileKey));
  for (const l of out.listings) {
    if (linked.has(profileKey(l.profileUrl)) && l.confidence < 0.8) {
      l.confidence = 0.8;
      l.note = `${l.note}; linked from the business's Google listing`;
    }
  }
  for (const s of out.sources) {
    if (linked.has(profileKey(s.url)) && s.matched.confidence < 0.8) s.matched = { ...s.matched, confidence: 0.8 };
  }
}

function sourceFrom(provider: ReviewProvider, url: string, m: MatchResult, rating: number | null, count: number | null): ReviewSource {
  return { provider, url, rating, count, matched: { by: m.by, confidence: confidenceOf(m) } };
}

/**
 * Investigate search hits for one business. `maxScrapes` caps paid page reads; Google Maps is tried separately
 * (one scrape) because web search never returns the Maps listing itself.
 */
export async function investigateWeb(
  fc: Firecrawl,
  biz: BusinessIdentity,
  hits: SearchHit[],
  opts: { maxScrapes?: number; googleQuery?: string | null } = {},
): Promise<ReviewsOutcome> {
  const out: ReviewsOutcome = { sources: [], reviews: [], listings: [], thirdParty: [], company: null, rejected: [], social: [], warnings: [] };
  const seenProfiles = new Set<string>();
  let scrapes = 0;
  const maxScrapes = opts.maxScrapes ?? 10;

  // Profile pages first, most-queried first (a page several searches agree on is more likely the business).
  const ranked = hits
    .map((h) => ({ h, p: detectProvider(h.url) }))
    .filter((x): x is { h: SearchHit; p: ProviderInfo } => Boolean(x.p && x.p.isProfile) && !isSameSite(x.h.url, biz.website))
    .sort((a, b) => b.h.queries.length - a.h.queries.length);

  for (const { h, p } of ranked) {
    const key = canonicalUrl(h.url).split("?")[0];
    if (seenProfiles.has(key)) continue;
    // The same company on a second Companies House host (data.companieshouse.gov.uk) adds nothing.
    if (p.id === "companies_house" && out.company && h.url.includes(out.company.number)) continue;
    seenProfiles.add(key);
    const { name: titleName, place } = splitTitle(h.title ?? "");
    const snippet: Candidate = { url: h.url, name: titleName || null, text: `${h.title ?? ""}\n${h.description ?? ""}`, place, isRegistry: p.id === "companies_house" };
    const pre = matchEntity(biz, snippet);
    if (!pre.matched && pre.by.length <= 1 && (pre.confidence === 0 || place)) {
      // Unrelated names are search noise; only same-name look-alikes are worth showing the owner.
      if (pre.verdict === "different_business") out.rejected.push({ url: h.url, reason: `${p.label}: ${pre.reason}` });
      continue;
    }

    let page: ScrapeResult | null = null;
    const wantsJson = Boolean(p.review && p.review !== "google" && p.review !== "facebook");
    if (p.scrapable && scrapes < maxScrapes) {
      try {
        scrapes++;
        page = await fc.scrape({
          url: h.url,
          formats: wantsJson ? ["markdown", "links", { type: "json", prompt: PROVIDER_PAGE_PROMPT, schema: PROVIDER_JSON_SCHEMA }] : ["markdown", "links"],
          onlyMainContent: false,
        });
      } catch (err) {
        out.warnings.push(`Couldn't read ${p.label} (${(err as Error).message.slice(0, 80)}); checked the search result only.`);
      }
    }
    const md = page?.markdown ?? "";
    const cand: Candidate = page
      ? { url: h.url, name: pageName(md, page.metadata?.title) ?? snippet.name, text: md, links: page.links, isRegistry: snippet.isRegistry }
      : snippet;
    const m = matchEntity(biz, cand);
    if (!m.matched) {
      if (m.verdict === "different_business") out.rejected.push({ url: h.url, reason: `${p.label}: ${m.reason}` });
      continue;
    }

    if (p.id === "companies_house") {
      const facts = companiesHouseFacts(md, h.url);
      if (facts && !out.company) out.company = facts;
      continue;
    }
    if (p.id === "facebook" || p.id === "instagram" || p.id === "linkedin") {
      if (!out.social.some((s) => s.network === p.id)) out.social.push({ network: p.id, url: h.url.split("?")[0] });
    }

    // Reviews
    if (p.review) {
      const facts = page ? PROVIDER_PAGE_SCHEMA.safeParse(page.json).data ?? null : null;
      const verified = verifyProviderFacts(facts, md, p.review, h.url);
      const snip = ratingFromSnippet(h.description);
      const rating = verified.rating ?? (page ? null : (snip?.rating ?? null));
      const count = verified.count ?? (page ? null : (snip?.count ?? null));
      if (rating !== null || (count !== null && count > 0) || verified.reviews.length) {
        out.sources.push(sourceFrom(p.review, h.url, m, rating, count));
        out.reviews.push(...verified.reviews);
      }
    }
    // Accreditation listings on the body's own site
    if (p.badge) {
      const note =
        p.id === "which"
          ? `Listed on Which? Trusted Traders (${m.reason.replace(/\.$/, "")})`
          : `Profile on ${p.label} (${m.reason.replace(/\.$/, "")})`;
      const src = out.sources.find((s) => s.url === h.url);
      out.listings.push({ body: p.badge, profileUrl: h.url, matched: true, confidence: m.confidence, note, rating: src?.rating ?? null, reviewCount: src?.count ?? null });
      if (p.id === "trustmark" && md) {
        const scheme = trustmarkSchemeBodies(md);
        for (const body of scheme.bodies) {
          out.listings.push({
            body,
            profileUrl: h.url,
            matched: true,
            confidence: m.confidence,
            note: `TrustMark lists ${BADGE_NAMES[body]} as this business's scheme provider${scheme.licence ? ` (licence ${scheme.licence})` : ""}`,
            rating: null,
            reviewCount: null,
          });
        }
      }
    }
    // Memberships stated in text on third-party pages (claims, not verification)
    if (md) {
      // Only the business's own section of the page (directory menus mention every scheme under the sun).
      const name = cand.name ?? "";
      const from = name ? Math.max(0, md.indexOf(name)) : 0;
      const section = md.slice(from, from + 15000).replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
      for (const body of badgeBodiesIn(section)) {
        if (body !== p.badge) out.thirdParty.push({ body, url: h.url, note: `Mentioned on ${p.label}` });
      }
    }
  }

  // Google: the Maps listing (rating only; the count and review text need the Business Profile connection).
  if (opts.googleQuery) {
    const url = `https://www.google.com/maps/search/?api=1&hl=en&query=${encodeURIComponent(opts.googleQuery)}`;
    try {
      const page = await fc.scrape({ url, formats: ["markdown", "links"], waitFor: 3000, location: { country: "GB" } });
      const md = page.markdown ?? "";
      const g = googleMapsFacts(md);
      const m = matchEntity(biz, { url, name: g.name, text: md, links: page.links });
      if (g.name && m.matched && (g.rating !== null || g.count !== null)) {
        out.sources.push(sourceFrom("google", url, m, g.rating, g.count));
        // Profiles the Google listing itself links to ("Book online" → Checkatrade) are the same business.
        if (m.by.some((b) => b !== "name")) confirmLinkedProfiles(out, page.links ?? []);
        out.warnings.push(
          g.count === null
            ? "Google shows your star rating but not the number of reviews to us. Connect your Google Business Profile to import Google reviews."
            : "We imported your Google star rating and review count. Connect your Google Business Profile to show the Google reviews themselves.",
        );
      } else if (g.name && !m.matched) {
        out.rejected.push({ url, reason: `Google Maps: ${m.reason}` });
        out.warnings.push("We couldn't confirm your Google listing. Connect your Google Business Profile to import Google reviews.");
      } else {
        out.warnings.push("We couldn't read Google reviews. Connect your Google Business Profile to import Google reviews.");
      }
    } catch {
      out.warnings.push("We couldn't read Google reviews. Connect your Google Business Profile to import Google reviews.");
    }
  }
  return out;
}
