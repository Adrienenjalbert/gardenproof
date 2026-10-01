import { describe, expect, it } from "vitest";
import { DEFAULT_OUTPUTS, jobAssetTypesFor, readOutputs, videoFormatsFor } from "./outputs";

describe("content outputs", () => {
  it("is lean by default: page, Google post and one portrait reveal", () => {
    const o = readOutputs({});
    expect(o).toEqual(DEFAULT_OUTPUTS);
    expect(jobAssetTypesFor(o)).toEqual(["portfolio_page", "gbp_post"]);
    expect(videoFormatsFor(o)).toEqual({ reveal: ["9:16"], proof: [], process: [] });
  });

  it("adds ads, social and every video shape when switched on, ignoring junk", () => {
    const o = readOutputs({ outputs: { ads: true, social: true, allVideoFormats: true, areaArticles: "yes" } });
    expect(o).toEqual({ ads: true, social: true, areaArticles: false, allVideoFormats: true });
    expect(jobAssetTypesFor(o)).toEqual(["portfolio_page", "ad_copy", "social_pack", "gbp_post"]);
    expect(videoFormatsFor(o)).toBeUndefined();
  });
});
