/**
 * Entity matching: is this web page about THIS business, or a same-name business somewhere else?
 *
 * Trade names collide constantly ("Thorburn Garden Services" in Duns vs "Thorburn Landscapes" in Wimbledon),
 * so a name match alone is never enough. We accept a candidate when:
 *   - its name shares the business's distinctive words, AND
 *   - a strong identifier matches (phone, website/email domain, company number or full postcode), OR the name is
 *     the same after dropping legal suffixes AND its location agrees (outward code / town) with nothing contradicting.
 * Everything else is rejected with a plain-English reason the owner can read.
 */
import { compactName, distinctiveTokens, findCompanyNumbers, findEmails, findPhones, findPostcodes, nameSimilarity, outwardOf, postcodeArea } from "./text";
import { bareHost } from "./url";

export type MatchSignal = "name" | "postcode" | "phone" | "website" | "company_number";

export type BusinessIdentity = {
  name: string;
  legalName?: string | null;
  phones: string[]; // national digits
  emails: string[];
  website: string; // site URL
  postcodes: string[]; // "SW19 3NW"
  /** Outward codes and towns the business works in (from its address and area pages). */
  outwardCodes: string[];
  places: string[]; // "Wimbledon", "London", "Putney"…
  companyNumber?: string | null;
};

export type Candidate = {
  url: string;
  /** The business name as the page shows it (title/h1). */
  name: string | null;
  /** Visible text we have for it: a search snippet, or the scraped page. */
  text: string;
  /** Links on the page (for website matching). */
  links?: string[];
  /** A place the page says the business is in (e.g. the "| Duns" of a Facebook title). */
  place?: string | null;
  /** Registries list a registered office (often the accountant's), so postcode mismatches don't contradict. */
  isRegistry?: boolean;
};

export type MatchResult = {
  matched: boolean;
  by: MatchSignal[];
  confidence: number;
  reason: string;
  /**
   * Why it didn't match: a different name (search noise), a different business (a look-alike worth showing the
   * owner), or unconfirmed (same name, nothing to confirm or contradict it — e.g. an Instagram bio).
   */
  verdict: "match" | "different_name" | "different_business" | "unconfirmed";
};

const lc = (s: string) => s.toLowerCase();

/** "Thorburn Garden Services | Duns - Facebook" → { name: "Thorburn Garden Services", place: "Duns" }. */
export function splitTitle(title: string): { name: string; place: string | null } {
  const cleaned = title.replace(/\s*[-–|•·]\s*(facebook|instagram|linkedin|yell|checkatrade|trustpilot|houzz|google maps|trustmark|which\?.*|companies house.*|gov\.uk)\s*$/i, "").trim();
  const parts = cleaned.split(/\s+[|–•·]\s+|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  // Registries append the company number to the name ("thorburn landscapes limited 09013186").
  // "(@handle)" and "(Surrey)" qualifiers are not part of the name.
  const name = (parts[0] ?? cleaned)
    .replace(/\s+\(?(?:SC|NI|OC)?\d{6,8}\)?$/i, "")
    .replace(/\s*\((@[^)]*|[^)]{1,30})\)\s*/g, " ")
    .trim();
  const tail = parts[1] ?? null;
  // Only treat the tail as a place when it is short and looks like a town, not a slogan or a category.
  const place =
    tail && /^[A-Z][A-Za-z' .-]{1,30}$/.test(tail) && tail.split(/\s+/).length <= 3 && !/\b(reviews?|landscap\w*|garden\w*|services?|contractors?|limited|ltd|profile|home|videos?|photos?|posts?|about|events?|reels?|community|mentions)\b/i.test(tail)
      ? tail
      : null;
  return { name, place };
}

export function matchEntity(biz: BusinessIdentity, c: Candidate): MatchResult {
  const text = `${c.name ?? ""}\n${c.text}`;
  const candName = c.name ?? "";
  const ours = [biz.name, biz.legalName].filter((x): x is string => Boolean(x));
  const distinct = new Set(ours.flatMap(distinctiveTokens));
  const candTokens = new Set(distinctiveTokens(candName || text.slice(0, 200)));
  const compactHit = ours.some((n) => compactName(text).includes(compactName(n)));
  const sharesDistinct = [...distinct].some((t) => candTokens.has(t));
  const sim = candName ? Math.max(...ours.map((n) => nameSimilarity(n, candName))) : compactHit ? 1 : 0;

  if (!sharesDistinct && !compactHit) {
    return { matched: false, by: [], confidence: 0, reason: `Different business name ("${candName || "unknown"}").`, verdict: "different_name" };
  }

  const by = new Set<MatchSignal>(["name"]);
  const phones = new Set(findPhones(text));
  if (biz.phones.some((p) => phones.has(p))) by.add("phone");

  const host = bareHost(biz.website);
  const linkHosts = new Set((c.links ?? []).map((l) => bareHost(l)).filter(Boolean));
  if (host && (linkHosts.has(host) || lc(text).includes(host))) by.add("website");
  const ourEmailDomains = new Set(biz.emails.map((e) => e.split("@")[1]));
  if (findEmails(text).some((e) => ourEmailDomains.has(e.split("@")[1]) || e.split("@")[1] === host)) by.add("website");

  if (biz.companyNumber && (findCompanyNumbers(text).includes(biz.companyNumber) || text.includes(biz.companyNumber))) by.add("company_number");

  const candPostcodes = findPostcodes(text);
  const postcodeHit = candPostcodes.some((p) => biz.postcodes.includes(p));
  if (postcodeHit) by.add("postcode");

  const ourOutwards = new Set([...biz.outwardCodes, ...biz.postcodes.map(outwardOf)].map((o) => o.toUpperCase()));
  const ourAreas = new Set([...ourOutwards].map(postcodeArea));
  const outwardHit = [...text.matchAll(/\b([A-Z]{1,2}\d[A-Z\d]?)\b/g)].some((m) => ourOutwards.has(m[1]));
  const places = biz.places.map(lc);
  const placeHit = places.some((p) => p.length > 2 && new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));

  // Contradictions: a stated place outside the business's area, or only postcodes from other postcode areas.
  const contradictions: string[] = [];
  if (c.place && !places.includes(lc(c.place))) contradictions.push(`it is based in ${c.place}`);
  if (!c.isRegistry && candPostcodes.length && !candPostcodes.some((p) => ourAreas.has(postcodeArea(p)))) {
    contradictions.push(`its postcode ${candPostcodes[0]} is outside your area`);
  }

  const strong = [...by].filter((s) => s === "phone" || s === "website" || s === "company_number" || s === "postcode");
  const exactName = sim >= 0.99;
  const confidence = Math.min(1, Math.round((0.35 * sim + 0.25 * strong.length + (outwardHit || placeHit ? 0.15 : 0) - 0.3 * contradictions.length) * 100) / 100);

  if (strong.length > 0 && (exactName || sim >= 0.5 || strong.length >= 2)) {
    return { matched: true, by: [...by], confidence: Math.max(confidence, 0.6), reason: `Matched on ${[...by].join(", ")}.`, verdict: "match" };
  }
  if (exactName && contradictions.length === 0 && (outwardHit || placeHit || c.isRegistry)) {
    return { matched: true, by: [...by], confidence: Math.max(Math.min(confidence, 0.75), 0.55), reason: "Same name and area; no phone or website on the page to confirm.", verdict: "match" };
  }
  const why: string[] = [];
  if (!exactName && candName) why.push(`the name "${candName}" is not "${biz.name}"`);
  why.push(...contradictions);
  if (!strong.length) why.push("no matching phone, website, postcode or company number");
  if (exactName && contradictions.length === 0) {
    return { matched: false, by: [...by], confidence: Math.max(0, confidence), reason: "Same name, but nothing on the page confirms it is you.", verdict: "unconfirmed" };
  }
  return { matched: false, by: [...by], confidence: Math.max(0, confidence), reason: `Different business: ${why.join("; ")}.`, verdict: "different_business" };
}
