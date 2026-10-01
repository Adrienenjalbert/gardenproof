import { describe, expect, it } from "vitest";
import {
  allChecksPass,
  assetExcerpt,
  consentBlockers,
  groupByStage,
  isFromPortfolio,
  leadSummary,
  limitState,
  overviewHeadline,
  pickCover,
  qualityFlags,
  timeAgo,
  wordCount,
} from "./logic";

describe("approval guards", () => {
  const checks = [
    { id: "consent.photos", ok: true, message: "photos ok" },
    { id: "consent.first_name", ok: false, message: "no first name consent" },
    { id: "limits.meta", ok: false, message: "too long" },
  ];
  it("only failed consent checks block approval", () => {
    expect(consentBlockers(checks).map((c) => c.id)).toEqual(["consent.first_name"]);
    expect(consentBlockers(checks.filter((c) => c.id !== "consent.first_name"))).toEqual([]);
  });
  it("bulk approve needs every check to pass", () => {
    expect(allChecksPass(checks)).toBe(false);
    expect(allChecksPass([checks[0]])).toBe(true);
    expect(allChecksPass([])).toBe(true);
  });
});

describe("overviewHeadline", () => {
  it("reads as plain English with correct plurals", () => {
    expect(overviewHeadline({ jobsThisMonth: 3, assetsInReview: 2, repliesPending: 1, heldMessages: 0 })).toEqual([
      "3 jobs captured this month",
      "2 assets waiting for you",
      "1 homeowner reply pending",
    ]);
    expect(overviewHeadline({ jobsThisMonth: 1, assetsInReview: 0, repliesPending: 2, heldMessages: 1 })).toEqual([
      "1 job captured this month",
      "nothing waiting for review",
      "2 homeowner replies pending",
      "1 message held for approval",
    ]);
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  it("formats past and future", () => {
    expect(timeAgo(new Date("2026-09-23T11:59:30Z"), now)).toBe("just now");
    expect(timeAgo(new Date("2026-09-20T12:00:00Z"), now)).toBe("3 days ago");
    expect(timeAgo(new Date("2026-09-23T14:00:00Z"), now)).toBe("in 2 hours");
    expect(timeAgo(null, now)).toBe("—");
  });
});

describe("media helpers", () => {
  it("splits quality notes into flags and flags low scores without notes", () => {
    expect(qualityFlags({ qualityScore: 0.4, qualityNotes: "needs blur; slightly dark" })).toEqual(["needs blur", "slightly dark"]);
    expect(qualityFlags({ qualityScore: 0.4, qualityNotes: null })).toEqual(["low quality"]);
    expect(qualityFlags({ qualityScore: 0.9, qualityNotes: null })).toEqual([]);
  });
  it("groups by stage and prefers an after hero as cover", () => {
    const items = [
      { id: "b", stage: "before" as const, isHero: true, kind: "image" },
      { id: "a1", stage: "after" as const, isHero: false, kind: "image" },
      { id: "a2", stage: "after" as const, isHero: true, kind: "image" },
      { id: "v", stage: "after" as const, isHero: true, kind: "audio" },
    ];
    expect(groupByStage(items).after.map((m) => m.id)).toEqual(["a1", "a2", "v"]);
    expect(pickCover(items)?.id).toBe("a2");
    expect(pickCover(items.slice(0, 1))?.id).toBe("b");
    expect(pickCover([])).toBeNull();
  });
});

describe("limits", () => {
  it("flags near and over", () => {
    expect(limitState(10, 30)).toBe("ok");
    expect(limitState(27, 30)).toBe("near");
    expect(limitState(31, 30)).toBe("over");
    expect(wordCount("  Circle-cut sandstone in Putney ")).toBe(4);
    expect(wordCount("")).toBe(0);
  });
});

describe("leads", () => {
  const base = { source: null, landingPage: null, projectSlug: null, assetId: null };
  it("counts portfolio-driven leads and groups sources", () => {
    const leads = [
      { ...base, source: "google", projectSlug: "x" },
      { ...base, source: "Google", landingPage: "/projects/y" },
      { ...base, source: "facebook", assetId: "ast_1" },
      { ...base, landingPage: "/contact/" },
    ];
    expect(isFromPortfolio(leads[3])).toBe(false);
    expect(leadSummary(leads)).toEqual({
      total: 4,
      fromPortfolio: 3,
      bySource: [
        { source: "google", count: 2 },
        { source: "direct", count: 1 },
        { source: "facebook", count: 1 },
      ],
    });
  });
});

describe("assetExcerpt", () => {
  it("picks the most telling field per type and truncates", () => {
    expect(assetExcerpt("video", { hook: "Circle-cut sandstone" })).toBe("Circle-cut sandstone");
    expect(assetExcerpt("ad_copy", { meta: { primaryTexts: ["First", "Second"] } })).toBe("First");
    expect(assetExcerpt("social_pack", { captions: "not an array" })).toBe("");
    expect(assetExcerpt("gbp_post", { text: "x".repeat(300) })).toHaveLength(178);
  });
});
