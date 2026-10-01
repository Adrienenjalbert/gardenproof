/**
 * Splits the stored consent evidence (`testimonials.consentWording`, e.g. "[YES] Photos of your garden: …")
 * into the four permissions so the dashboard can show each answer next to the exact words the homeowner saw.
 */

export type ConsentField = "consentPhotos" | "consentQuote" | "consentArea" | "consentFirstName";

export const CONSENT_FIELDS: { key: ConsentField; label: string; match: RegExp }[] = [
  { key: "consentPhotos", label: "Photos of the garden", match: /photo/i },
  { key: "consentQuote", label: "Their words (quote)", match: /\b(words?|quote)\b/i },
  { key: "consentArea", label: "Area name", match: /\barea\b/i },
  { key: "consentFirstName", label: "First name", match: /first name/i },
];

export type WordingLine = { answer: boolean | null; title: string; statement: string };

export function parseConsentWording(wording: string | null): {
  lines: Partial<Record<ConsentField, WordingLine>>;
  other: string[];
} {
  const lines: Partial<Record<ConsentField, WordingLine>> = {};
  const other: string[] = [];
  for (const raw of (wording ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[(YES|NO)\]\s*([^:]+):\s*(.*)$/i);
    if (!m) {
      other.push(line);
      continue;
    }
    const [, ans, title, statement] = m;
    // Match on the title first ("Your first name"), falling back to the statement; first name before area.
    const field =
      CONSENT_FIELDS.find((f) => f.key === "consentFirstName" && f.match.test(title)) ??
      CONSENT_FIELDS.find((f) => f.match.test(title)) ??
      CONSENT_FIELDS.find((f) => f.match.test(statement));
    const entry = { answer: ans.toUpperCase() === "YES", title: title.trim(), statement: statement.trim() };
    if (field && !lines[field.key]) lines[field.key] = entry;
    else other.push(line);
  }
  return { lines, other };
}
