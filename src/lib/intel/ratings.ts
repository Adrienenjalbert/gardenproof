/**
 * Ratings: every source is normalised to "out of 5", and the headline rating is weighted by review count across
 * matched sources. A source without a published count (Google via Maps, Checkatrade with no current score) is
 * kept per-source but never guessed into the aggregate.
 */
import type { PublicReview, ReviewSource } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Normalise a rating to /5. `scale` is what the provider rates out of (Checkatrade: 10). Without a scale,
 * values above 5 are assumed to be /10 (only when ≤ 10); anything else is rejected as unreadable.
 */
export function normaliseRating(value: number | string | null | undefined, scale?: number | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const v = typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(v) || v < 0) return null;
  const s = scale && scale > 0 ? scale : v <= 5 ? 5 : v <= 10 ? 10 : v <= 100 ? 100 : null;
  if (!s || v > s) return null;
  return round2((v / s) * 5);
}

/** Headline rating: count-weighted mean over sources that publish both a rating and a count. */
export function aggregateRating(sources: Pick<ReviewSource, "rating" | "count">[]): { rating: number | null; count: number } {
  let weight = 0;
  let sum = 0;
  for (const s of sources) {
    if (s.rating === null || s.count === null || s.count <= 0) continue;
    weight += s.count;
    sum += s.rating * s.count;
  }
  return { rating: weight ? round2(sum / weight) : null, count: weight };
}

/** Parse the date formats review sites use ("16/07/2026", "02 December 2019", ISO) to YYYY-MM-DD, else null. */
export function parseReviewDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const dmy = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    const date = new Date(Date.UTC(+y, +m - 1, +d));
    return Number.isNaN(date.getTime()) || +m > 12 ? null : date.toISOString().slice(0, 10);
  }
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // "02 December 2019", "2nd Dec 2019", "December 2, 2019" — built in UTC so the day never shifts.
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const dm = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/.exec(s);
  const md = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(s);
  const parts = dm ? { d: dm[1], m: dm[2], y: dm[3] } : md ? { d: md[2], m: md[1], y: md[3] } : null;
  const month = parts ? months.indexOf(parts.m.slice(0, 3).toLowerCase()) : -1;
  if (!parts || month < 0 || +parts.d < 1 || +parts.d > 31) return null;
  return new Date(Date.UTC(+parts.y, month, +parts.d)).toISOString().slice(0, 10);
}

/**
 * Pick 3–6 reviews to feature: good ratings (≥ 4/5 or unrated), readable length, newest first, taking turns
 * across providers so one site doesn't fill the strip.
 */
export function pickFeaturedReviews(reviews: PublicReview[], max = 6): PublicReview[] {
  const good = reviews
    .filter((r) => (r.rating === null || r.rating >= 4) && r.text.length >= 40)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.text.length - a.text.length);
  const byProvider = new Map<string, PublicReview[]>();
  for (const r of good) byProvider.set(r.provider, [...(byProvider.get(r.provider) ?? []), r]);
  const out: PublicReview[] = [];
  const seen = new Set<string>();
  while (out.length < max && [...byProvider.values()].some((l) => l.length)) {
    for (const list of byProvider.values()) {
      const next = list.shift();
      if (!next) continue;
      const key = next.text.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(next);
      if (out.length >= max) break;
    }
  }
  return out;
}
