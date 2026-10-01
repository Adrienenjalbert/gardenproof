import { describe, expect, it } from "vitest";
import { ASSET_TYPES } from "@/lib/domain";
import { FIELD_SPECS, fieldToText, getAt, setAt, textToField, validateAssetContent } from "./asset-fields";

describe("path helpers", () => {
  it("gets and immutably sets nested values", () => {
    const src = { a: { b: 1, c: 2 }, d: [1] };
    const out = setAt(src, ["a", "b"], 5);
    expect(out).toEqual({ a: { b: 5, c: 2 }, d: [1] });
    expect(src.a.b).toBe(1);
    expect(out.d).toBe(src.d);
    expect(getAt(out, ["a", "b"])).toBe(5);
    expect(getAt(out, ["x", "y"])).toBeUndefined();
    expect(setAt(undefined, ["x", "y"], 1)).toEqual({ x: { y: 1 } });
  });
});

describe("field conversions", () => {
  const list = FIELD_SPECS.ad_copy.find((s) => s.path.join(".") === "meta.headlines")!;
  const ctaUrl = FIELD_SPECS.gbp_post.find((s) => s.path.join(".") === "ctaUrl")!;
  it("lists are one item per line, blank lines dropped", () => {
    expect(fieldToText(list, { meta: { headlines: ["a", "b"] } })).toBe("a\nb");
    expect(textToField(list, " a \n\n b\n")).toEqual(["a", "b"]);
  });
  it("nullable fields store empty as null", () => {
    expect(textToField(ctaUrl, "  ")).toBeNull();
    expect(fieldToText(ctaUrl, { ctaUrl: null })).toBe("");
  });
  it("every asset type has structured fields", () => {
    for (const t of ASSET_TYPES) expect(FIELD_SPECS[t].length).toBeGreaterThan(0);
  });
});

describe("validateAssetContent", () => {
  it("returns path-prefixed errors", () => {
    const r = validateAssetContent("gbp_post", { text: "x", mediaId: null, ctaType: "NOPE", ctaUrl: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^ctaType:/);
  });
  it("accepts valid content and applies defaults", () => {
    const r = validateAssetContent("video", { template: "reveal", ratio: "9:16", hook: "Hi", props: {} });
    expect(r.ok && r.content.durationSec).toBeNull();
  });
});
