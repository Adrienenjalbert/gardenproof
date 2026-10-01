/**
 * Deterministic quality checks for generated assets (stored in assets.checks).
 * Pure: no I/O, no model. Every rule returns one Check so the dashboard can show a
 * stable checklist (ok / message) per asset.
 */
import { ASSET_CONTENT_SCHEMAS, type AssetType } from "@/lib/domain";
import { parseNumberWord, slugify, wordCount } from "./text";
import type { Check, LintContext } from "./types";

/** Keys whose values are ids/urls/enums, not public prose. */
const NON_PROSE_KEYS = new Set([
  "mediaId", "beforeMediaId", "afterMediaId", "carouselOrder", "relatedJobIds", "url", "ctaUrl", "slug", "ctaType",
  "stage", "props", "template", "ratio", "angle",
]);

export function collectText(value: unknown, key = ""): string[] {
  if (NON_PROSE_KEYS.has(key)) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => collectText(v));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => collectText(v, k));
  return [];
}

const pass = (id: string, message: string): Check => ({ id, ok: true, message });
const fail = (id: string, message: string): Check => ({ id, ok: false, message });
const result = (id: string, problems: string[], okMsg: string): Check =>
  problems.length ? fail(id, problems.join("; ")) : pass(id, okMsg);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// Individual rules (exported for unit tests)
// ---------------------------------------------------------------------------
export function checkBanned(text: string, banned: string[]): Check {
  const hits = banned.filter((p) => {
    const re = /^\w/.test(p) ? new RegExp(`\\b${escapeRe(p)}`, "i") : new RegExp(escapeRe(p), "i");
    return re.test(text);
  });
  return result("banned-phrases", hits.map((h) => `banned phrase "${h}"`), "No banned phrases.");
}

const US_SPELLINGS: [RegExp, string][] = [
  [/\bcolor(s|ed|ful|ing)?\b/i, "colour"],
  [/\bcenter(s|ed)?\b/i, "centre"],
  [/\bfavorite(s)?\b/i, "favourite"],
  [/\bneighbor(s|hood|hoods|ing)?\b/i, "neighbour"],
  [/\bgray\b/i, "grey"],
  [/\bfiber\b/i, "fibre"],
  [/\baluminum\b/i, "aluminium"],
  [/\bmold(s|ing|ed)?\b/i, "mould"],
  [/\blabor\b/i, "labour"],
  [/\bcozy\b/i, "cosy"],
  [/\bbackyard(s)?\b/i, "back garden"],
  [/\bsidewalk(s)?\b/i, "pavement"],
  [/\bleveled|leveling\b/i, "levelled / levelling"],
  [/\btraveled|traveling\b/i, "travelled / travelling"],
  [/\bmodeling\b/i, "modelling"],
  [/\b(real|organ|special|custom|personal|priorit|visual|recogn|final|util)iz(e|ed|es|ing|ation)\b/i, "-ise spelling"],
  [/\bmeters\b/i, "metres"],
  [/\b(gotten|fall season|yard work)\b/i, "British phrasing"],
];

export function checkBritish(text: string): Check {
  const hits = US_SPELLINGS.flatMap(([re, uk]) => {
    const m = text.match(re);
    return m ? [`"${m[0]}" → ${uk}`] : [];
  });
  return result("british-spelling", hits, "British spelling.");
}

export function checkExclamations(text: string): Check {
  const count = (text.match(/!/g) ?? []).length;
  if (/!{2,}/.test(text)) return fail("exclamations", "Repeated exclamation marks.");
  if (count > 1) return fail("exclamations", `${count} exclamation marks — keep the tone calm (max 1).`);
  return pass("exclamations", "Calm punctuation.");
}

const GRAMMAR_SLIPS: [RegExp, string][] = [
  [/\b(?:(?:a|an) +(?:and|or|a|an|the|two|three|four|five|six)|the +(?:and|or|a|an|the))\b/i, "misplaced article"],
  [/\ba +[aei](?!u)[a-z]/i, "'a' before a vowel"],
  [/\b(and|or|with) +(and|or|with)\b/i, "doubled conjunction"],
  [/\b([a-z]{2,}) +\1\b/i, "repeated word"],
  [/\ban +[bcdfgjklmnpqrstvwxyz][a-z]/i, "'an' before a consonant"],
  [/ [,.;:](?=\s|$)/, "space before punctuation"],
  [/(?<!\.)\.\.(?!\.)|,,/, "doubled punctuation"],
];

/** Cheap fluency guard: catches the template/model slips a reviewer would be embarrassed by. */
export function checkGrammar(text: string): Check {
  const hits = GRAMMAR_SLIPS.flatMap(([re, label]) => {
    const m = text.match(re);
    return m ? [`${label}: "${m[0].trim()}"`] : [];
  });
  return result("grammar", hits, "No obvious grammar slips.");
}

const FULL_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const OUTWARD_CODE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\b/g;
const HOUSE_ADDRESS =
  /\b(?:no\.?\s*)?\d{1,4}[a-z]?,?\s+(?:[A-Z][a-z]+\s+){1,3}(?:Road|Rd|Street|St|Avenue|Ave|Lane|Close|Crescent|Gardens|Drive|Way|Place|Grove|Terrace|Hill|Park|Mews|Square|Court|Rise|Walk|Row)\b/;
const STREET_NAME = /\b(?:[A-Z][a-z]+\s+){1,2}(?:Road|Street|Avenue|Lane|Close|Crescent|Drive|Grove|Mews)\b/;
const FLAT = /\bFlat\s+\d+\b/;

export function checkPrivacy(text: string, slug: string | null, ctx: Pick<LintContext, "areaNamed" | "outwardCode" | "forbidden">): Check {
  const problems: string[] = [];
  const pc = text.match(FULL_POSTCODE);
  if (pc) problems.push(`full postcode "${pc[0]}"`);
  const addr = text.match(HOUSE_ADDRESS) ?? text.match(STREET_NAME) ?? text.match(FLAT);
  if (addr) problems.push(`looks like an address: "${addr[0]}"`);
  for (const code of new Set(text.match(OUTWARD_CODE) ?? [])) {
    if (!ctx.areaNamed) problems.push(`postcode district "${code}" without area consent`);
    else if (ctx.outwardCode && code !== ctx.outwardCode) problems.push(`postcode district "${code}" is not this job's (${ctx.outwardCode})`);
  }
  for (const f of ctx.forbidden) {
    if (new RegExp(`\\b${escapeRe(f.term)}\\b`).test(text)) problems.push(`"${f.term}": ${f.reason}`);
    const s = slugify(f.term);
    if (slug && s && new RegExp(`(^|-)${escapeRe(s)}(-|$)`).test(slug)) problems.push(`slug contains "${s}": ${f.reason}`);
  }
  return result("privacy", problems, "No address, postcode or non-consented personal details.");
}

// ---------------------------------------------------------------------------
// Homeowner quote: verbatim or not at all (never cut mid-sentence to fit a field)
// ---------------------------------------------------------------------------
const QUOTED = /[“"]([^”"\n]+)[”"]/g;
const normQuote = (s: string) => s.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/** True when `excerpt` is the consented quote, or whole sentences copied from it word for word. */
export function isVerbatimQuote(excerpt: string, quote: string): boolean {
  const q = normQuote(quote);
  const x = normQuote(excerpt).replace(/[.!?,;:…]+$/, "");
  if (!x) return false;
  const at = q.indexOf(x);
  if (at < 0) return false;
  const startOk = at === 0 || /[.!?]["”’)]?\s*$/.test(q.slice(0, at));
  const rest = q.slice(at + x.length);
  const endOk = /^[.!?,;:…]*$/.test(rest) || /^[.!?]/.test(rest);
  return startOk && endOk;
}

/** Every quoted passage (3+ words) must be the consented quote, verbatim and uncut. */
export function checkQuotes(text: string, quote: string | null): Check {
  const problems: string[] = [];
  for (const m of text.matchAll(QUOTED)) {
    const inner = m[1].trim();
    if (inner.split(/\s+/).length < 3) continue;
    const short = inner.length > 60 ? `${inner.slice(0, 57)}…` : inner;
    if (!quote) problems.push(`quoted text “${short}” but there is no consented homeowner quote`);
    else if (!isVerbatimQuote(inner, quote)) problems.push(`“${short}” is not the homeowner's words verbatim (never shorten or edit a quote)`);
  }
  return result("quote-verbatim", problems, "Any quote is the homeowner's consented words, verbatim.");
}

// ---------------------------------------------------------------------------
// Fluency: repeated noun phrases and run-on CTAs (template slips a reader notices)
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "with", "by", "from", "is", "was", "it", "this",
  "that", "its", "as", "be", "are", "we", "our", "your", "you", "all", "into", "out", "up",
]);

/** Fails when a 2–4 word phrase repeats inside one sentence ("a garden design built around a garden design"). */
export function checkRepetition(text: string): Check {
  const problems = new Set<string>();
  // A label and its list ("**Project name:** materials") are separate phrases, so ":" ends one too.
  for (const line of text.replace(/\*+/g, "").split(/\n+/)) {
    for (const sentence of line.split(/(?<=[.!?:])\s+/)) {
      const words = sentence.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
      for (let n = 4; n >= 2; n--) {
        const seen = new Set<string>();
        for (let i = 0; i + n <= words.length; i++) {
          const gram = words.slice(i, i + n);
          if (STOPWORDS.has(gram[0]) || STOPWORDS.has(gram[n - 1])) continue;
          const key = gram.join(" ");
          if (seen.has(key) && ![...problems].some((p) => p.includes(key))) problems.add(key);
          seen.add(key);
        }
      }
    }
  }
  return result("repetition", [...problems].map((p) => `repeated phrase "${p}" in one sentence`), "No repeated phrases.");
}

/** The CTA must start a new sentence: "…– Harriet, Wimbledon Book a consultation" reads as a run-on. */
export function checkCtaPunctuation(texts: string[], cta: string | null): Check {
  if (!cta?.trim()) return pass("cta-punctuation", "No CTA text configured.");
  const problems: string[] = [];
  const re = new RegExp(escapeRe(cta.trim()), "g");
  for (const t of texts) {
    for (const m of t.matchAll(re)) {
      const before = t.slice(0, m.index).replace(/[\s[(*_]+$/, "");
      if (before && !/[.!?…:]["”’)]?$/.test(before)) {
        problems.push(`missing sentence end before the CTA: "…${before.slice(-30)} ${cta.trim()}"`);
      }
    }
  }
  return result("cta-punctuation", problems, "The call to action starts its own sentence.");
}

const UNIT_WORDS = "days?|weeks?|months?|years?|metres?|m|sq|square|trees|beds|stars?|projects|gardens|jobs|people|men|crew";
const WORD_NUM = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty";

/** Every number mentioned (digits, and number words followed by a unit), for claim tracing. */
export function numbersIn(text: string): number[] {
  const clean = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/#\w+/g, " ")
    .replace(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\b/g, " "); // outward codes are checked by privacy
  const out: number[] = [];
  for (const m of clean.matchAll(/(?<![A-Za-z\d.])(\d+(?:\.\d+)?)(?![A-Za-z\d])/g)) out.push(Number(m[1]));
  const wordRe = new RegExp(`\\b(${WORD_NUM})(\\s+and\\s+a\\s+half)?\\s+(${UNIT_WORDS})\\b`, "gi");
  for (const m of clean.matchAll(wordRe)) {
    const n = parseNumberWord(m[1]);
    if (n != null) out.push(n + (m[2] ? 0.5 : 0));
  }
  const halves = clean.match(/\bhalf\s+a\s+(day|week)\b/gi) ?? [];
  out.push(...halves.map(() => 0.5));
  return out;
}

const SUPERLATIVES = /\b(award[- ]winning|number one|no\.?\s?1\b|#1|guaranteed?|cheapest|best in|market[- ]leading|leading|top[- ]rated|voted|unbeatable|finest)\b/gi;

export function checkClaims(text: string, ctx: Pick<LintContext, "sourceText" | "rating" | "whichRating" | "year">): Check {
  const problems: string[] = [];
  const allowedRatings = new Set<number>([ctx.rating, ctx.whichRating ? Number(ctx.whichRating) : null].filter((x): x is number => x != null));

  const starRe = new RegExp(`\\b(\\d(?:\\.\\d)?|${WORD_NUM})[\\s-]*stars?\\b`, "gi");
  for (const m of text.matchAll(starRe)) {
    const n = parseNumberWord(m[1]);
    if (n == null || !allowedRatings.has(n)) problems.push(`"${m[0]}" is not backed by a rating`);
  }
  for (const m of text.matchAll(/\b(\d(?:\.\d)?)\s*(?:\/|out of)\s*5\b/gi)) {
    if (!allowedRatings.has(Number(m[1]))) problems.push(`"${m[0]}" is not backed by a rating`);
  }
  for (const m of text.matchAll(SUPERLATIVES)) {
    if (!new RegExp(escapeRe(m[0]), "i").test(ctx.sourceText)) problems.push(`unsupported claim "${m[0]}"`);
  }

  const allowed = new Set<number>([...numbersIn(ctx.sourceText), ...allowedRatings, ctx.year, ctx.year - 1]);
  const stripped = text.replace(/\b(\d(?:\.\d)?)\s*(?:\/|out of)\s*5\b/gi, " ");
  const unknown = [...new Set(numbersIn(stripped).filter((n) => !allowed.has(n)))];
  if (unknown.length) problems.push(`number(s) not found in job data: ${unknown.join(", ")}`);
  return result("claims", problems, "Every number and rating traces to job data.");
}

export function checkSlug(slug: string): Check {
  const ok = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80 && slug.length >= 3;
  return ok ? pass("slug", "Slug format OK.") : fail("slug", `Invalid slug "${slug}" (lowercase words joined by hyphens, max 80).`);
}

function checkMediaIds(ids: (string | null | undefined)[], mediaIds: string[]): Check {
  const known = new Set(mediaIds);
  const bad = ids.filter((i): i is string => !!i && !known.has(i));
  return result("media-ids", bad.map((b) => `media ${b} is not a public image of this job`), "All media belong to this job.");
}

const limit = (label: string, s: string, max: number) => (s.length > max ? [`${label} is ${s.length} chars (max ${max})`] : []);
const minLen = (label: string, s: string, min: number) => (s.length < min ? [`${label} is ${s.length} chars (min ${min})`] : []);

const CTA_RE = /\b(book|call|arrange|enquire|get in touch|contact|request|visit|see (?:the|more))\b/i;

// ---------------------------------------------------------------------------
// Per type
// ---------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

function typeChecks(type: AssetType, c: Obj, ctx: LintContext): Check[] {
  switch (type) {
    case "portfolio_page": {
      const gallery = arr(c.gallery).map(obj);
      const ba = obj(c.beforeAfter);
      const t = c.testimonial ? obj(c.testimonial) : null;
      const cta = obj(c.cta);
      return [
        checkSlug(str(c.slug)),
        result(
          "lengths",
          [
            ...limit("SEO title", str(c.seoTitle), 65), ...minLen("SEO title", str(c.seoTitle), 25),
            ...limit("Meta description", str(c.metaDescription), 160), ...minLen("Meta description", str(c.metaDescription), 70),
            ...limit("H1", str(c.h1), 90), ...minLen("Summary", str(c.summary), 80),
          ],
          "Title, meta and headings within limits.",
        ),
        checkMediaIds([...gallery.map((g) => str(g.mediaId)), str(ba.beforeMediaId), str(ba.afterMediaId)], ctx.mediaIds),
        gallery.length === 0
          ? fail("alt-text", "Gallery is empty.")
          : result(
              "alt-text",
              gallery
                .filter((g) => str(g.alt).trim().length < 15 || /\.(jpe?g|png|webp)$|^(image|photo|img|picture)\b/i.test(str(g.alt)))
                .map((g) => `weak alt text on ${str(g.mediaId)}`),
              "Every image has descriptive alt text.",
            ),
        str(cta.text) && /^https?:\/\//.test(str(cta.url)) ? pass("cta", "Call to action present.") : fail("cta", "Missing call to action."),
        !t
          ? pass("consent", "No testimonial used.")
          : ctx.rating == null || ctx.quote == null
            ? fail("consent", "Testimonial shown without a consented, responded testimonial.")
            : Number(t.rating) !== ctx.rating
              ? fail("consent", `Testimonial rating ${String(t.rating)} does not match the homeowner's ${ctx.rating}.`)
              : normQuote(str(t.quote)) !== normQuote(ctx.quote)
                ? fail("consent", "Testimonial text differs from the homeowner's consented words (quote verbatim, never edit).")
                : pass("consent", "Testimonial matches the homeowner's consented response."),
      ];
    }
    case "seo_article":
      return [
        checkSlug(str(c.slug)),
        result(
          "lengths",
          [
            ...limit("SEO title", str(c.seoTitle), 65), ...limit("Meta description", str(c.metaDescription), 160),
            ...minLen("Meta description", str(c.metaDescription), 70),
            ...(wordCount(str(c.bodyMarkdown)) < 250 ? [`body is ${wordCount(str(c.bodyMarkdown))} words (thin; min 250)`] : []),
          ],
          "Title, meta and body length OK.",
        ),
        arr(c.relatedJobIds).length >= 2 ? pass("cluster", "Backed by 2+ real projects.") : fail("cluster", "Needs at least 2 related projects (no thin pages)."),
        CTA_RE.test(str(c.bodyMarkdown)) ? pass("cta", "Call to action present.") : fail("cta", "Missing call to action."),
      ];
    case "ad_copy": {
      const meta = obj(c.meta);
      const pmax = obj(c.pmax);
      const each = (xs: unknown, label: string, max: number) => arr(xs).flatMap((s, i) => limit(`${label} ${i + 1}`, str(s), max));
      const words = arr(meta.hooks).flatMap((h, i) => (wordCount(str(h)) > 6 ? [`hook ${i + 1} has ${wordCount(str(h))} words (max 6)`] : []));
      const all = [...arr(meta.primaryTexts), ...arr(pmax.descriptions), ...arr(meta.headlines)].map(str).join(" ");
      return [
        result(
          "lengths",
          [
            ...words,
            ...each(meta.primaryTexts, "primary text", 125), ...each(meta.headlines, "Meta headline", 40),
            ...each(pmax.headlines, "PMax headline", 30), ...each(pmax.longHeadlines, "PMax long headline", 90),
            ...each(pmax.descriptions, "PMax description", 90),
          ],
          "All ad fields within platform limits.",
        ),
        CTA_RE.test(all) ? pass("cta", "Call to action present.") : fail("cta", "No call to action in primary texts, headlines or descriptions."),
      ];
    }
    case "social_pack": {
      const tags = arr(c.hashtags).map(str);
      return [
        result(
          "lengths",
          [
            ...arr(c.captions).flatMap((s, i) => limit(`caption ${i + 1}`, str(s), 2200)),
            ...(tags.length > 12 ? [`${tags.length} hashtags (max 12)`] : []),
            ...tags.filter((t) => !/^#[A-Za-z0-9]+$/.test(t)).map((t) => `bad hashtag "${t}"`),
          ],
          "Captions and hashtags OK.",
        ),
        checkMediaIds(arr(c.carouselOrder).map(str), ctx.mediaIds),
        CTA_RE.test(arr(c.captions).map(str).join(" ")) ? pass("cta", "Call to action present.") : fail("cta", "Missing call to action."),
      ];
    }
    case "gbp_post":
      return [
        result("lengths", [...limit("Post", str(c.text), 1500), ...minLen("Post", str(c.text), 100)], "Post length OK."),
        checkMediaIds([str(c.mediaId)], ctx.mediaIds),
        c.ctaType === "CALL" || /^https?:\/\//.test(str(c.ctaUrl)) ? pass("cta", "Call to action present.") : fail("cta", "Missing CTA URL."),
      ];
    case "video":
      return [];
  }
}

/** Run every applicable check. `content` may be invalid; the schema check reports that. */
export function lintAsset(type: AssetType, content: unknown, ctx: LintContext): Check[] {
  const parsed = ASSET_CONTENT_SCHEMAS[type].safeParse(content);
  const schemaCheck = parsed.success
    ? pass("schema", "Matches the content contract.")
    : fail("schema", parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const c = obj(content);
  const texts = collectText(c);
  const text = texts.join("\n");
  return [
    schemaCheck,
    checkBanned(text, ctx.bannedPhrases),
    checkBritish(text),
    checkExclamations(text),
    checkGrammar(text),
    checkPrivacy(text, typeof c.slug === "string" ? c.slug : null, ctx),
    checkClaims(text, ctx),
    checkQuotes(text, ctx.quote),
    checkRepetition(text),
    checkCtaPunctuation(texts, ctx.ctaText),
    ...typeChecks(type, c, ctx),
  ];
}

export const lintPassed = (checks: Check[]): boolean => checks.every((c) => c.ok);
