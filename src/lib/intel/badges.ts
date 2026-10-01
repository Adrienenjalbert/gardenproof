/**
 * Trust badges: which accreditation bodies the business shows on its own site, and which of those we could verify
 * on the body's OWN site with an entity match.
 *
 *   verified  → a profile for THIS business on the body's own site (Which?, Checkatrade, TrustMark…; APL also via
 *               the TrustMark listing when it names APL as the scheme provider).
 *   claimed   → only the business's site (a logo or a mention) or third-party text says so.
 *
 * Badge images are the ones the business already shows (downloaded, never recreated). Many sites use logos with no
 * alt text and meaningless file names ("Logo-250-x-150-4.png"), so logos are also recognised by a perceptual
 * fingerprint against a small library of known accreditation logos.
 */
import { ancestors, findAll, parseHtml, textOf, type HtmlEl } from "./html";
import { hammingHex } from "./images";
import { BADGE_NAMES, badgeBodiesIn } from "./providers";
import type { Badge, BadgeBody } from "./types";
import { absolutise, isSameSite } from "./url";

/**
 * dHash fingerprints of accreditation logos as UK trade sites commonly display them (see images.logoFingerprint).
 * Extend this list when onboarding reports an unrecognised badge image. Distance ≤ 14 bits = same logo.
 */
export const KNOWN_LOGOS: { body: BadgeBody; name: string; hash: string }[] = [
  { body: "trustmark", name: BADGE_NAMES.trustmark, hash: "84a9b1b2b2969680" },
  { body: "hta", name: BADGE_NAMES.hta, hash: "32717252565159d0" },
  { body: "checkatrade", name: BADGE_NAMES.checkatrade, hash: "2222a8aacbe62a4a" },
  { body: "other", name: "Jacksons Fencing Approved Installer", hash: "49a92ab2d2d8ad29" },
  { body: "apl", name: BADGE_NAMES.apl, hash: "06c4e06067aaa8c8" },
  { body: "which", name: BADGE_NAMES.which, hash: "c8866d61616d86cc" },
  { body: "safecontractor", name: BADGE_NAMES.safecontractor, hash: "f0b22b733b96ccf0" },
];
export const LOGO_MATCH_MAX_DISTANCE = 14;

export function identifyByFingerprint(hash: string | null): { body: BadgeBody; name: string; distance: number } | null {
  if (!hash) return null;
  let best: { body: BadgeBody; name: string; distance: number } | null = null;
  for (const k of KNOWN_LOGOS) {
    const d = hammingHex(hash, k.hash);
    if (d <= LOGO_MATCH_MAX_DISTANCE && (!best || d < best.distance)) best = { body: k.body, name: k.name, distance: d };
  }
  return best;
}

const FILE_TOKENS: [BadgeBody, RegExp][] = [
  ["which", /(^|[-_./ ])which([-_./ ]|$)|trusted[-_ ]?trader/i],
  ["checkatrade", /checkatrade/i],
  ["trustmark", /trustmark/i],
  ["apl", /(^|[-_./ ])apl([-_./ ]|$)/i],
  ["hta", /(^|[-_./ ])hta([-_./ ]|$)/i],
  ["bali", /(^|[-_./ ])bali([-_./ ]|$)/i],
  ["safecontractor", /safe[-_ ]?contractor/i],
  ["trustatrader", /trust[-_ ]?a[-_ ]?trader/i],
  ["fmb", /(^|[-_./ ])fmb([-_./ ]|$)/i],
];

/** Identify a badge from its alt/title, file name and the link around it. */
export function identifyByText(parts: { alt?: string | null; title?: string | null; src?: string | null; href?: string | null }): BadgeBody | null {
  const words = [parts.alt, parts.title].filter(Boolean).join(" ");
  const fromWords = badgeBodiesIn(words)[0];
  if (fromWords) return fromWords;
  const file = `${decodeURIComponent((parts.src ?? "").split("/").pop() ?? "")} ${parts.href ?? ""}`;
  for (const [body, re] of FILE_TOKENS) if (re.test(file)) return body;
  return null;
}

export type BadgeImageCandidate = { src: string; alt: string | null; title: string | null; href: string | null; pageUrl: string; width: number | null; height: number | null };

const stemOf = (u: string) => (u.split("/").pop() ?? "").replace(/(-\d+x\d+)?\.[a-z0-9]+(\?.*)?$/i, "").toLowerCase();
const PHOTO_NAME = /(img|dsc|pxl|photo|image)[-_]?\d{3,}|\d{8}_\d{6}|whatsapp/i;

/**
 * Logo-sized images from the business's pages that could be accreditation badges: small (≤ 420×300 when sizes are
 * declared), not the site logo, not photos, not inside the menu. De-duplicated by URL.
 */
export function collectBadgeImages(rawHtml: string, pageUrl: string, opts: { logoUrl?: string | null; max?: number } = {}): BadgeImageCandidate[] {
  const root = parseHtml(rawHtml);
  const seen = new Set<string>();
  const out: BadgeImageCandidate[] = [];
  for (const img of findAll(root, (e) => e.tag === "img")) {
    const src = absolutise(img.attrs.src?.startsWith("data:") ? img.attrs["data-src"] ?? img.attrs["data-lazy-src"] : (img.attrs.src ?? img.attrs["data-src"]), pageUrl);
    if (!src || !/^https?:/.test(src) || seen.has(src) || src === opts.logoUrl) continue;
    if (/\.(svg|gif|jpe?g)(\?|$)/i.test(src) && !identifyByText({ src })) continue; // badges are PNG/WebP logos
    if (opts.logoUrl && stemOf(src) === stemOf(opts.logoUrl)) continue; // another copy of the site logo
    const w = parseInt(img.attrs.width ?? "", 10) || null;
    const h = parseInt(img.attrs.height ?? "", 10) || null;
    const link = ancestors(img).find((a) => a.tag === "a");
    const href = link ? absolutise(link.attrs.href, pageUrl) : null;
    const known = identifyByText({ alt: img.attrs.alt, title: img.attrs.title, src, href });
    const small = (w === null || w <= 420) && (h === null || h <= 300) && !(w === null && h === null && !known);
    if (!known && (!small || PHOTO_NAME.test(src))) continue;
    if (ancestors(img).some((a: HtmlEl) => a.tag === "nav" || a.tag === "header")) continue;
    seen.add(src);
    out.push({ src, alt: img.attrs.alt || null, title: img.attrs.title || null, href, pageUrl, width: w, height: h });
    if (out.length >= (opts.max ?? 30)) break;
  }
  return out;
}

/** Bodies mentioned in visible text of the business's own pages (claims). */
export function bodiesMentioned(markdownOrHtml: string): BadgeBody[] {
  const raw = /<[a-z]/i.test(markdownOrHtml) ? textOf(parseHtml(markdownOrHtml)) : markdownOrHtml;
  // Link and image URLs are not claims ("safecontractor-logo.png" is handled as an image).
  const text = raw.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, " ");
  return badgeBodiesIn(text);
}

export type SiteBadge = { body: BadgeBody; name: string; imageUrl: string | null; imageKey: string | null; evidenceUrl: string; how: string };
export type BodyListing = {
  body: BadgeBody;
  profileUrl: string;
  matched: boolean;
  confidence: number;
  note: string;
  rating: number | null;
  reviewCount: number | null;
};
export type ThirdPartyClaim = { body: BadgeBody; url: string; note: string };

/** Pure decision: merge site evidence, body listings and third-party mentions into badges with a status. */
export function decideBadges(input: { site: SiteBadge[]; listings: BodyListing[]; thirdParty?: ThirdPartyClaim[]; siteUrl: string }): Badge[] {
  const keyOf = (body: BadgeBody, name: string) => (body === "other" ? `other:${name.toLowerCase()}` : body);
  const badges = new Map<string, Badge>();
  const ensure = (body: BadgeBody, name: string): Badge => {
    const k = keyOf(body, name);
    let b = badges.get(k);
    if (!b) {
      b = { body, name, verified: false, status: "claimed", profileUrl: null, evidence: [], imageUrl: null, imageKey: null, rating: null, reviewCount: null };
      badges.set(k, b);
    }
    return b;
  };

  for (const s of input.site) {
    const b = ensure(s.body, s.name);
    if (!b.imageUrl && s.imageUrl) {
      b.imageUrl = s.imageUrl;
      b.imageKey = s.imageKey;
    }
    if (!b.evidence.some((e) => e.url === s.evidenceUrl && e.note === s.how)) b.evidence.push({ url: s.evidenceUrl, note: s.how });
  }
  for (const l of input.listings) {
    // A listing for a different business is not evidence of anything (it is reported under `rejected`).
    if (!l.matched || isSameSite(l.profileUrl, input.siteUrl)) continue;
    const b = ensure(l.body, BADGE_NAMES[l.body]);
    if (l.confidence >= 0.55) {
      b.verified = true;
      b.status = "verified";
      b.profileUrl = b.profileUrl ?? l.profileUrl;
      b.rating = b.rating ?? l.rating;
      b.reviewCount = b.reviewCount ?? l.reviewCount;
      b.evidence.unshift({ url: l.profileUrl, note: l.note });
    } else {
      b.evidence.push({ url: l.profileUrl, note: `Possible listing (weak match): ${l.note}` });
    }
  }
  for (const t of input.thirdParty ?? []) {
    const b = badges.get(keyOf(t.body, BADGE_NAMES[t.body])) ?? ensure(t.body, BADGE_NAMES[t.body]);
    if (!b.evidence.some((e) => e.url === t.url)) b.evidence.push({ url: t.url, note: t.note });
  }
  const order: BadgeBody[] = ["which", "trustmark", "checkatrade", "apl", "bali", "hta", "fmb", "safecontractor", "trustatrader", "other"];
  return [...badges.values()]
    .filter((b) => b.evidence.length > 0)
    .sort((a, b) => Number(b.verified) - Number(a.verified) || order.indexOf(a.body) - order.indexOf(b.body));
}
