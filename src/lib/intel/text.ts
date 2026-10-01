/**
 * Text normalisers shared by extraction and entity matching: UK phone numbers, postcodes, business names.
 */

/** UK postcode (full), tolerant of missing space: "SW19 3NW", "sw193nw". */
export const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/gi;
/** Outward code on its own ("SW19", "KT2"), used for job locations and area lists. */
export const OUTWARD_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\b/g;

export function normalisePostcode(pc: string): string | null {
  const m = /^\s*([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\s*$/i.exec(pc);
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : null;
}

export const outwardOf = (pc: string): string => pc.trim().toUpperCase().split(/\s+/)[0];
/** Postcode area: the leading letters ("SW" for SW19, "TD" for TD11). */
export const postcodeArea = (pc: string): string => (/^[A-Z]{1,2}/i.exec(pc.trim())?.[0] ?? "").toUpperCase();

export function findPostcodes(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(POSTCODE_RE)) {
    const pc = normalisePostcode(`${m[1]} ${m[2]}`);
    if (pc) out.add(pc);
  }
  return [...out];
}

/** Digits of a UK number in national form: "+44 (0)20 8064 1303" → "02080641303". Null if not phone-like. */
export function normalisePhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+44")) d = `0${d.slice(3)}`;
  else if (d.startsWith("0044")) d = `0${d.slice(4)}`;
  d = d.replace(/\+/g, "");
  if (d.startsWith("00")) return null;
  if (d.startsWith("440") && d.length === 13) d = d.slice(2);
  return /^0\d{9,10}$/.test(d) ? d : null;
}

/** All UK-looking phone numbers in free text (national form). */
export function findPhones(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\+44\s?\(?0?\)?|\b0)[\d\s().-]{8,15}\d/g)) {
    const p = normalisePhone(m[0]);
    if (p) out.add(p);
  }
  return [...out];
}

/** "02080641303" → "020 8064 1303" (London/area-code style), mobiles "07505 671751". */
export function formatUkPhone(national: string): string {
  const d = national.replace(/\D/g, "");
  if (/^02\d{9}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
  if (/^0[1-9]\d{9}$/.test(d)) return `${d.slice(0, 5)} ${d.slice(5)}`;
  return national;
}

export const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
export function findEmails(text: string): string[] {
  return [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()).filter((e) => !/\.(png|jpe?g|webp|gif|svg)$/.test(e)))];
}

/** UK company number (8 chars: digits, or SC/NI/OC… prefix + 6 digits). */
export function findCompanyNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:company\s*(?:no\.?|number|reg(?:istration)?\.?(?:\s*no\.?)?)\s*[:.]?\s*)((?:SC|NI|OC|SO|NC|R0)?\d{6,8})\b/gi)) {
    out.add(m[1].toUpperCase().padStart(8, "0"));
  }
  return [...out];
}

/** Legal suffixes and filler words that say nothing about WHICH business it is. */
const LEGAL = new Set(["ltd", "limited", "llp", "plc", "co", "company", "uk", "the", "and", "of", "&", "inc"]);
/** Trade words: shared by thousands of businesses, so they never identify one on their own. */
const GENERIC = new Set([
  "landscapes", "landscape", "landscaping", "landscaper", "landscapers", "garden", "gardens", "gardening", "gardener", "gardeners",
  "services", "service", "design", "designs", "build", "builders", "building", "construction", "contractors", "contractor",
  "maintenance", "group", "solutions", "outdoor", "living", "trees", "tree", "surgery", "paving", "fencing", "driveways",
  "plumbing", "heating", "electrical", "roofing", "home", "homes", "improvements", "property", "projects", "studio", "london",
]);

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !LEGAL.has(t));
}

/** Tokens that actually distinguish this business ("thorburn" in "Thorburn Landscapes Ltd"). */
export const distinctiveTokens = (name: string): string[] => nameTokens(name).filter((t) => !GENERIC.has(t));

/** Letters-only form, so "ThorburnLandscapes" equals "Thorburn Landscapes Ltd". */
export const compactName = (name: string): string => nameTokens(name).join("");

/**
 * Name similarity in [0,1]: 1 when the names are the same after dropping legal suffixes (or equal when
 * squashed together); otherwise the Jaccard overlap of their tokens.
 */
export function nameSimilarity(a: string, b: string): number {
  const ca = compactName(a);
  const cb = compactName(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / new Set([...ta, ...tb]).size;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "business"
  );
}

export const collapse = (s: string): string => s.replace(/[\s ]+/g, " ").trim();

/** Loose comparison key for checking that a quoted text really appears on a page. */
export const looseKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’“”'"`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Title-case a label taken from a URL slug: "garden-design" → "Garden design". */
export function labelFromSlug(slug: string): string {
  const s = decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}
