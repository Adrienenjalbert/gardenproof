/**
 * Small, pure text helpers shared by the mock copywriter, the lint rules and the assemblers.
 * British English, sentence case, no Oxford comma (Thorburn house style).
 */

export const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Lower-case the first letter unless the first word is a proper noun we must keep ("Indian sandstone"). */
export function lowerFirst(s: string): string {
  if (!s) return s;
  const first = s.split(/\s+/)[0];
  if (PROPER_WORDS.has(first.toLowerCase().replace(/[^a-z]/g, "")) || /^[A-Z]{2,}/.test(first)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

const PROPER_WORDS = new Set(["indian", "york", "japanese", "corten", "mediterranean", "portland", "cotswold", "purbeck"]);

/** Restore capitals on proper nouns that crews tend to type in lower case. */
export function fixProperNouns(s: string): string {
  return s.replace(/\b(indian|york|japanese|corten|mediterranean|portland|cotswold|purbeck)\b/gi, (m) => cap(m.toLowerCase()));
}

/** "a, b and c" (no Oxford comma). */
export function joinList(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

const PLURAL_HEADS = /(beds|stones|trees|borders|steps|planters|setts|sleepers|walls|hedges|plants|grasses|ferns|roses|lights|gates|slabs|pavers|hydrangeas|alliums|salvias)$/i;

export function isPlural(phrase: string): boolean {
  const last = phrase.trim().split(/\s+/).pop() ?? "";
  return PLURAL_HEADS.test(last) || (/s$/i.test(last) && !/(ss|us|is|grass|moss)$/i.test(last));
}

const MASS_NOUNS = new Set([
  "grass", "junk", "rubbish", "gravel", "turf", "mud", "moss", "ivy", "concrete", "soil", "paving", "fencing",
  "decking", "hedging", "screening", "lighting", "planting", "sandstone", "porcelain", "brickwork", "timber", "clay",
  "hornbeam", "lavender", "box", "yew", "bark", "mulch", "topsoil",
]);
const TRAILING_ADVERBS = new Set(["everywhere", "throughout", "galore", "all", "over"]);

/** Add "a"/"an" to singular phrases that have no determiner yet. */
export function withArticle(phrase: string): string {
  const p = phrase.trim();
  if (!p) return p;
  if (/^(a|an|the|two|three|four|five|six|some|\d+)\s/i.test(p) || isPlural(p)) return p;
  const words = p.toLowerCase().split(/\s+/).filter((w) => !TRAILING_ADVERBS.has(w));
  if (MASS_NOUNS.has(words[words.length - 1] ?? "")) return p;
  return `${/^[aeiou]/i.test(p) ? "an" : "a"} ${p}`;
}

export const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/** First candidate that fits `max` characters (and optional word limit); else a word-safe truncation of the last. */
export function fit(candidates: (string | null | undefined | false)[], max: number, maxWords = Infinity): string {
  const xs = candidates.filter((c): c is string => typeof c === "string" && c.trim().length > 0).map((c) => c.trim());
  const ok = xs.find((c) => c.length <= max && wordCount(c) <= maxWords);
  if (ok) return ok;
  return truncateWords(xs[xs.length - 1] ?? "", max);
}

/** All candidates that fit, de-duplicated (case-insensitive), in order. */
export function fitAll(candidates: (string | null | undefined | false)[], max: number, maxWords = Infinity): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const t = c.trim();
    const key = t.toLowerCase();
    if (!t || t.length > max || wordCount(t) > maxWords || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function truncateWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1).split(/\s+/).slice(0, -1).join(" ");
  return (cut || s.slice(0, max)).replace(/[,;:\s–—-]+$/, "");
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80)
    .replace(/-+$/, "");
}

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const stripEndPunct = (s: string): string => s.trim().replace(/[.!?;,:\s]+$/, "");

export function hashtag(words: string): string {
  const body = words
    .replace(/&/g, "and")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => cap(w.toLowerCase()))
    .join("");
  return body ? `#${body}` : "";
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};
const NUMBER_NAMES = Object.fromEntries(
  Object.entries(NUMBER_WORDS).filter(([k]) => k !== "a" && k !== "an").map(([k, v]) => [v, k]),
) as Record<number, string>;

export function numberWord(n: number): string {
  return NUMBER_NAMES[n] ?? String(n);
}

export function parseNumberWord(w: string): number | null {
  const k = w.toLowerCase();
  if (k in NUMBER_WORDS) return NUMBER_WORDS[k];
  const n = Number(k);
  return Number.isFinite(n) ? n : null;
}

/** "about three weeks" / "2.5 weeks" / "two and a half weeks" -> { days, text }. */
export function parseDuration(text: string): { days: number; text: string } | null {
  const re =
    /\b((?:about|around|roughly|just over|just under|nearly|almost)\s+)?(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(\s+and\s+a\s+half)?\s+(day|week|month)s?\b/i;
  const m = text.match(re);
  if (!m) return null;
  const base = parseNumberWord(m[2]);
  if (base == null) return null;
  const qty = base + (m[3] ? 0.5 : 0);
  const unit = m[4].toLowerCase();
  const perUnit = unit === "day" ? 1 : unit === "week" ? 7 : 30;
  return { days: Math.max(1, Math.round(qty * perUnit)), text: m[0].toLowerCase().replace(/\s+/g, " ").trim() };
}

/** 18 -> "two and a half weeks"; 3 -> "three days". Used when only durationDays is known. */
export function formatDuration(days: number | null | undefined): string | null {
  if (!days || days <= 0) return null;
  if (days < 7) return `${numberWord(days)} day${days === 1 ? "" : "s"}`;
  const halfWeeks = Math.round((days / 7) * 2) / 2;
  const whole = Math.floor(halfWeeks);
  const half = halfWeeks - whole === 0.5;
  if (whole === 0) return "half a week";
  const unit = whole === 1 && !half ? "week" : "weeks";
  return `${whole === 1 && half ? "one" : numberWord(whole)}${half ? " and a half" : ""} ${unit}`;
}
