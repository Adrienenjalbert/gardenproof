import { describe, expect, it } from "vitest";
import { clauses, extractFacts, rankFeatures } from "./lexicon";
import { fit, fitAll, formatDuration, joinList, parseDuration, slugify, withArticle } from "./text";

const POND =
  "Overgrown back garden, knee-high grass, old pergola and junk everywhere. Cleared it all, laid a self-binding gravel terrace with a circular brick-edged pond and solar fountain, new lawn at the back, cleaned up the borders and kept the mature trees. About three weeks.";

describe("extractFacts", () => {
  it("separates the before-state from the finished scope", () => {
    const f = extractFacts(POND);
    expect(f.challenge).toBe("Overgrown back garden, knee-high grass, old pergola and junk everywhere");
    expect(f.features).toEqual(["self-binding gravel terrace", "circular brick-edged pond", "solar fountain", "lawn", "borders", "mature trees"]);
    expect(f.features).not.toContain("pergola"); // the old pergola was removed, not built
    expect(f.materials).toEqual(["brick", "self-binding gravel"]);
    expect(f.durationDays).toBe(21);
    expect(f.durationText).toBe("about three weeks");
  });

  it("ignores location references and credits groundwork, not the thing on top", () => {
    const f = extractFacts("Planted five pleached hornbeam along the back fence for screening. Built the base for a cedar-clad garden room.");
    expect(f.features).toEqual(["pleached hornbeam", "cedar-clad garden room base"]);
    expect(f.materials).not.toContain("cedar");
  });

  it("does not mistake 'oak sleeper caps' for railway sleepers", () => {
    expect(extractFacts("Raised beds with oak sleeper caps.").materials).toEqual(["oak"]);
  });

  it("returns empty facts for empty notes", () => {
    expect(extractFacts(null).features).toEqual([]);
  });

  it("clauses split on commas and on 'and' + new item, but not 'and a half'", () => {
    expect(clauses("new striped lawn and a timber pergola, two and a half weeks")).toEqual(["new striped lawn", "a timber pergola", "two and a half weeks"]);
  });

  it("ranks the feature that sells the service first", () => {
    expect(rankFeatures(["lawn", "curved brick raised beds", "Indian sandstone patio"], "patio_paving")[0]).toBe("Indian sandstone patio");
  });
});

describe("text helpers", () => {
  it("joinList uses no Oxford comma", () => expect(joinList(["a", "b", "c"])).toBe("a, b and c"));
  it("withArticle handles vowels, plurals and mass nouns", () => {
    expect(withArticle("Indian sandstone patio")).toBe("an Indian sandstone patio");
    expect(withArticle("curved brick raised beds")).toBe("curved brick raised beds");
    expect(withArticle("knee-high grass")).toBe("knee-high grass");
    expect(withArticle("junk everywhere")).toBe("junk everywhere");
    expect(withArticle("new lawn")).toBe("a new lawn");
  });
  it("durations round-trip", () => {
    expect(parseDuration("Took two and a half weeks.")).toEqual({ days: 18, text: "two and a half weeks" });
    expect(parseDuration("3 days on site")).toEqual({ days: 3, text: "3 days" });
    expect(formatDuration(18)).toBe("two and a half weeks");
    expect(formatDuration(10)).toBe("one and a half weeks");
    expect(formatDuration(7)).toBe("one week");
    expect(formatDuration(null)).toBeNull();
  });
  it("fit picks the first candidate within limits", () => {
    expect(fit(["too long for this", "short"], 10)).toBe("short");
    expect(fit(["one two three four"], 12)).toBe("one two");
    expect(fitAll(["a b", "A B", "c d e f g h i", ""], 50, 6)).toEqual(["a b"]);
  });
  it("slugify", () => expect(slugify("Patios & Paving — Putney!")).toBe("patios-and-paving-putney"));
});
