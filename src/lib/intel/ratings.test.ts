import { describe, expect, it } from "vitest";
import { aggregateRating, normaliseRating, parseReviewDate, pickFeaturedReviews } from "./ratings";
import type { PublicReview } from "./types";

describe("normaliseRating", () => {
  it("normalises to /5", () => {
    expect(normaliseRating(5, 5)).toBe(5);
    expect(normaliseRating(10, 10)).toBe(5);
    expect(normaliseRating(9.25, 10)).toBe(4.63);
    expect(normaliseRating("4,8")).toBe(4.8);
    expect(normaliseRating(96, 100)).toBe(4.8);
  });
  it("infers the scale when missing, and rejects nonsense", () => {
    expect(normaliseRating(9.2)).toBe(4.6);
    expect(normaliseRating(4.9)).toBe(4.9);
    expect(normaliseRating(11, 10)).toBeNull();
    expect(normaliseRating(-1)).toBeNull();
    expect(normaliseRating(null)).toBeNull();
    expect(normaliseRating("n/a")).toBeNull();
    expect(normaliseRating(500)).toBeNull();
  });
});

describe("aggregateRating", () => {
  it("weights by review count and ignores sources without both numbers", () => {
    expect(
      aggregateRating([
        { rating: 5, count: 9 },
        { rating: 4, count: 1 },
        { rating: null, count: 27 }, // Checkatrade with no current score
        { rating: 4.9, count: null }, // Google rating without a count
      ]),
    ).toEqual({ rating: 4.9, count: 10 });
    expect(aggregateRating([])).toEqual({ rating: null, count: 0 });
  });
});

describe("parseReviewDate", () => {
  it("reads UK and long-form dates", () => {
    expect(parseReviewDate("16/07/2026")).toBe("2026-07-16");
    expect(parseReviewDate("Posted 02 December 2019")).toBe("2019-12-02");
    expect(parseReviewDate("2025-08-11T10:00:00Z")).toBe("2025-08-11");
    expect(parseReviewDate("yesterday-ish")).toBeNull();
    expect(parseReviewDate(null)).toBeNull();
  });
});

describe("pickFeaturedReviews", () => {
  const r = (provider: PublicReview["provider"], date: string, rating: number | null, text = "A long enough review text about a lovely new garden and a tidy team."): PublicReview => ({
    provider,
    author: null,
    text: `${provider} ${date}: ${text}`,
    rating,
    date,
    url: `https://x/${provider}`,
  });
  it("prefers recent good reviews and alternates providers", () => {
    const out = pickFeaturedReviews([r("which", "2026-07-16", 5), r("which", "2025-01-01", 5), r("which", "2024-01-01", 5), r("checkatrade", "2019-01-01", 5), r("checkatrade", "2018-01-01", 2)], 4);
    expect(out.map((x) => x.provider)).toEqual(["which", "checkatrade", "which", "which"]);
    expect(out.every((x) => (x.rating ?? 5) >= 4)).toBe(true);
  });
  it("skips very short reviews", () => {
    expect(pickFeaturedReviews([r("which", "2026-01-01", 5, "Great.")].map((x) => ({ ...x, text: "Great." })))).toEqual([]);
  });
});
