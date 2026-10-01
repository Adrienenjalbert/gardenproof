/**
 * Which review site / accrediting body a URL belongs to, and whether it is a single-business profile page
 * (worth matching) or a directory/search listing (never evidence about one business).
 */
import type { BadgeBody, ReviewProvider } from "./types";
import { bareHost } from "./url";

export type ProviderId =
  | ReviewProvider
  | "trustatrader"
  | "companies_house"
  | "apl"
  | "hta"
  | "bali"
  | "safecontractor"
  | "fmb"
  | "instagram"
  | "linkedin"
  | "ratedpeople"
  | "mybuilder";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  /** The review provider this maps to in the profile (null = not a review source). */
  review: ReviewProvider | null;
  /** The accrediting body whose OWN site this is (null = not an accrediting body). */
  badge: BadgeBody | null;
  /** Whether the page is one business's profile (vs a category/search listing). */
  isProfile: boolean;
  /** Can Firecrawl read it without a login wall? */
  scrapable: boolean;
};

type Rule = {
  id: ProviderId;
  label: string;
  hosts: RegExp;
  profile: RegExp;
  review: ReviewProvider | null;
  badge: BadgeBody | null;
  scrapable?: boolean;
};

const RULES: Rule[] = [
  { id: "which", label: "Which? Trusted Traders", hosts: /(^|\.)trustedtraders\.which\.co\.uk$/, profile: /^\/businesses\/[^/]+/, review: "which", badge: "which" },
  { id: "checkatrade", label: "Checkatrade", hosts: /(^|\.)checkatrade\.com$/, profile: /^\/trades\/[^/]+/i, review: "checkatrade", badge: "checkatrade" },
  { id: "trustmark", label: "TrustMark", hosts: /(^|\.)trustmark\.org\.uk$/, profile: /^\/firms\/[^/]+/i, review: null, badge: "trustmark" },
  { id: "trustpilot", label: "Trustpilot", hosts: /(^|\.)trustpilot\.com$/, profile: /^\/review\/[^/]+/, review: "trustpilot", badge: null },
  { id: "houzz", label: "Houzz", hosts: /(^|\.)houzz\.(co\.uk|com)$/, profile: /^\/(pro\/[^/]+|professionals\/[^/]+\/[^/]*pfvw)/i, review: "houzz", badge: null },
  { id: "google", label: "Google", hosts: /^(google\.[a-z.]+|maps\.google\.[a-z.]+|g\.page|maps\.app\.goo\.gl|business\.google\.com)$/, profile: /^\/(maps\/(place|search)\/|[^/]+)/, review: "google", badge: null },
  { id: "facebook", label: "Facebook", hosts: /(^|\.)facebook\.com$/, profile: /^\/(?!(groups|search|events|marketplace|watch|hashtag|sharer|photo|story)\b)(p\/)?[^/?]+\/?$/, review: "facebook", badge: null, scrapable: false },
  { id: "yell", label: "Yell", hosts: /(^|\.)yell\.com$/, profile: /^\/biz\//, review: "yell", badge: null },
  { id: "trustatrader", label: "TrustATrader", hosts: /(^|\.)trustatrader\.com$/, profile: /^\/traders\/[^/]+/, review: "other", badge: "trustatrader" },
  { id: "ratedpeople", label: "Rated People", hosts: /(^|\.)ratedpeople\.com$/, profile: /^\/profile\/[^/]+/, review: "other", badge: null },
  { id: "mybuilder", label: "MyBuilder", hosts: /(^|\.)mybuilder\.com$/, profile: /^\/profile\/view\/[^/]+/, review: "other", badge: null },
  { id: "companies_house", label: "Companies House", hosts: /(^|\.)(find-and-update\.company-information\.service\.gov\.uk|data\.companieshouse\.gov\.uk)$/, profile: /\/company\/[A-Z0-9]{8}/i, review: null, badge: null },
  { id: "apl", label: "Association of Professional Landscapers", hosts: /(^|\.)(landscaper\.org\.uk|apl-landscaping\.org\.uk)$/, profile: /\/(members?|landscapers?|directory|find-a-landscaper)\/[^/]+/i, review: null, badge: "apl" },
  { id: "hta", label: "Horticultural Trades Association", hosts: /(^|\.)hta\.org\.uk$/, profile: /\/(members?|directory|find-a-member)\/[^/]+/i, review: null, badge: "hta" },
  { id: "bali", label: "BALI", hosts: /(^|\.)bali\.org\.uk$/, profile: /\/(members?|directory|find-a-member|member-directory)\/[^/]+/i, review: null, badge: "bali" },
  { id: "safecontractor", label: "SafeContractor", hosts: /(^|\.)(safecontractor\.com|alcumusgroup\.com)$/, profile: /\/(contractor|directory)\/[^/]+/i, review: null, badge: "safecontractor" },
  { id: "fmb", label: "Federation of Master Builders", hosts: /(^|\.)fmb\.org\.uk$/, profile: /\/(find-a-builder|member)\/[^/]+/i, review: null, badge: "fmb" },
  { id: "instagram", label: "Instagram", hosts: /(^|\.)instagram\.com$/, profile: /^\/(?!p\/|reel\/|explore\/)[^/]+/, review: null, badge: null, scrapable: false },
  { id: "linkedin", label: "LinkedIn", hosts: /(^|\.)linkedin\.com$/, profile: /^\/company\/[^/]+/, review: null, badge: null, scrapable: false },
];

export function detectProvider(url: string): ProviderInfo | null {
  const host = bareHost(url);
  if (!host) return null;
  let path = "/";
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    /* keep "/" */
  }
  for (const r of RULES) {
    if (!r.hosts.test(host)) continue;
    // Google web search result pages are not business profiles; Maps place/search pages and g.page links are.
    const isProfile = r.id === "google" ? /^(maps\.|g\.page|maps\.app)/.test(host) || /^\/maps\//.test(path) : r.profile.test(path);
    return { id: r.id, label: r.label, review: r.review, badge: r.badge, isProfile, scrapable: r.scrapable ?? true };
  }
  return null;
}

/** Social networks we list on the profile (from the business's own site links). */
export function socialNetworkOf(url: string): string | null {
  const host = bareHost(url);
  if (!host) return null;
  const map: [RegExp, string][] = [
    [/(^|\.)instagram\.com$/, "instagram"],
    [/(^|\.)facebook\.com$/, "facebook"],
    [/(^|\.)(twitter|x)\.com$/, "x"],
    [/(^|\.)linkedin\.com$/, "linkedin"],
    [/(^|\.)youtube\.com$|^youtu\.be$/, "youtube"],
    [/(^|\.)tiktok\.com$/, "tiktok"],
    [/(^|\.)pinterest\.(com|co\.uk)$/, "pinterest"],
    [/(^|\.)houzz\.(com|co\.uk)$/, "houzz"],
  ];
  for (const [re, name] of map) if (re.test(host)) return name;
  return null;
}

export const BADGE_NAMES: Record<BadgeBody, string> = {
  which: "Which? Trusted Trader",
  checkatrade: "Checkatrade",
  trustmark: "TrustMark",
  apl: "Association of Professional Landscapers",
  hta: "HTA Member",
  bali: "BALI",
  safecontractor: "SafeContractor Approved",
  trustatrader: "TrustATrader",
  fmb: "Federation of Master Builders",
  other: "Accreditation",
};

/**
 * Words on a page or in an image name/alt/link that point at a body. Acronyms are matched case-sensitively
 * ("BALI", not a holiday in Bali); full names case-insensitively.
 */
export const BADGE_KEYWORDS: [BadgeBody, RegExp][] = [
  ["which", /\bwhich\?? ?trusted ?traders?\b|trustedtraders\.which|which[-_ ]?trusted/i],
  ["checkatrade", /check ?a ?trade/i],
  ["trustmark", /trust ?mark/i],
  ["apl", /association of professional landscapers|landscaper\.org\.uk|apl-landscaping/i],
  ["apl", /\bAPL\b/],
  ["hta", /horticultural trades? association|hta\.org\.uk/i],
  ["hta", /\bHTA\b/],
  ["bali", /british association of landscape industries|bali\.org\.uk/i],
  ["bali", /\bBALI\b/],
  ["safecontractor", /safe ?contractor/i],
  ["trustatrader", /trust ?a ?trader/i],
  ["fmb", /federation of master builders|fmb\.org\.uk/i],
  ["fmb", /\bFMB\b/],
];

/** Bodies named in a piece of text (deduplicated, in first-seen order). */
export function badgeBodiesIn(text: string): BadgeBody[] {
  const out: BadgeBody[] = [];
  for (const [body, re] of BADGE_KEYWORDS) if (re.test(text) && !out.includes(body)) out.push(body);
  return out;
}
