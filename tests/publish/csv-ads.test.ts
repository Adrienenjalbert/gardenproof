import { describe, expect, it } from "vitest";
import { buildGooglePmaxRows, buildMetaRows, fitItems, GOOGLE_LIMITS, withUtm, type AdBundleContext } from "@/lib/publish/ad-bundle";
import { csvCell, toCsv } from "@/lib/publish/csv";
import { gbpPostText, socialPackText } from "@/lib/publish/social-export";
import { patioAds, patioGbp, patioSocial, patioVideo } from "../fixtures/mod-d";

describe("csv", () => {
  it("quotes commas, quotes, newlines and edge whitespace", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(" padded")).toBe('" padded"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
  });

  it("guards spreadsheet formulas but keeps phone numbers and prices", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-cmd|x")).toBe("'-cmd|x");
    expect(csvCell("+44 20 7946 0000")).toBe("+44 20 7946 0000");
    expect(csvCell("- 10% off")).toBe("- 10% off");
  });

  it("joins rows with CRLF and prepends a BOM by default", () => {
    expect(toCsv([["a", "b"], ["1", "x,y"]])).toBe('﻿a,b\r\n1,"x,y"\r\n');
    expect(toCsv([["a"]], { bom: false })).toBe("a\r\n");
  });
});

const ctx: AdBundleContext = {
  jobCode: "TL-5937",
  area: "Putney",
  serviceLabel: "Patios & paving",
  businessName: "Thorburn Landscapes",
  finalUrl: "https://www.thorburnlandscapes.co.uk/projects/indian-sandstone-circle-patio-putney/",
  utmCampaign: "gp_tl-5937",
};

describe("fitItems", () => {
  it("dedupes case-insensitively, drops over-long items (never truncates) and caps the count", () => {
    const r = fitItems(["Hello", "hello ", "x".repeat(31), "A", "B"], "Headline", 30, 2);
    expect(r.kept).toEqual(["Hello", "A"]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain("31/30");
  });
  it("counts characters, not UTF-16 units", () => {
    expect(fitItems(["🌿".repeat(30)], "H", 30, 5).kept).toHaveLength(1);
  });
});

describe("buildGooglePmaxRows", () => {
  it("produces one wide asset-group row with Editor columns and tagged final URL", () => {
    const { rows, warnings } = buildGooglePmaxRows([{ assetId: "ast_ad1", content: patioAds }], ctx);
    const [header, row] = rows;
    expect(header).toHaveLength(4 + 15 + 5 + 5);
    expect(header.slice(0, 5)).toEqual(["Campaign", "Asset group", "Final URL", "Business name", "Headline 1"]);
    const get = (col: string) => row[header.indexOf(col)];
    expect(get("Asset group")).toBe("TL-5937 Putney | craft");
    expect(get("Headline 1")).toBe("Sandstone Patios Putney");
    expect(get("Headline 4")).toBe("");
    expect(get("Long headline 1")).toBe(patioAds.pmax.longHeadlines[0]);
    const url = new URL(String(get("Final URL")));
    expect(url.searchParams.get("utm_content")).toBe("asset_ast_ad1");
    expect(url.searchParams.get("utm_source")).toBe("google");
    expect(warnings).toEqual([]);
  });

  it("warns when minimums and the short-description rule are not met", () => {
    const thin = { ...patioAds, pmax: { headlines: ["One"], longHeadlines: [], descriptions: ["x".repeat(80)] } };
    const { warnings } = buildGooglePmaxRows([{ assetId: "a", content: thin }], ctx);
    expect(warnings.join("\n")).toMatch(/at least 3 headlines/);
    expect(warnings.join("\n")).toMatch(/at least 1 long headline/);
    expect(warnings.join("\n")).toMatch(new RegExp(`${GOOGLE_LIMITS.shortDescriptionChars} chars or fewer`));
  });
});

describe("buildMetaRows", () => {
  const video = { assetId: "ast_vid1", fileName: "reveal-9x16-ast_vid1.mp4", content: patioVideo };

  it("creates a row per video × copy variant with utm_content pointing at the creative", () => {
    const { rows } = buildMetaRows([{ assetId: "ast_ad1", content: patioAds }], [video], ctx);
    expect(rows).toHaveLength(1 + 3);
    const [header, first] = rows;
    const get = (col: string) => first[header.indexOf(col)];
    expect(get("Video File Name")).toBe("reveal-9x16-ast_vid1.mp4");
    expect(get("On-video Hook")).toBe("Before you pave, see this");
    expect(new URLSearchParams(String(get("URL Tags"))).get("utm_content")).toBe("asset_ast_vid1");
    expect(get("Website URL")).toBe(ctx.finalUrl);
  });

  it("warns about Meta display limits without dropping copy, and when no video is rendered", () => {
    const long = { ...patioAds, meta: { ...patioAds.meta, primaryTexts: ["y".repeat(130)], headlines: ["z".repeat(45)] } };
    const { rows, warnings } = buildMetaRows([{ assetId: "a", content: long }], [], ctx);
    expect(rows).toHaveLength(2);
    expect(warnings.join("\n")).toMatch(/over 125 chars/);
    expect(warnings.join("\n")).toMatch(/over 40 chars/);
    expect(warnings.join("\n")).toMatch(/No rendered videos/);
  });

  it("round-trips through CSV escaping", () => {
    const tricky = { ...patioAds, meta: { ...patioAds.meta, primaryTexts: ['Patio, "sandstone"\nPutney'] } };
    const csv = toCsv(buildMetaRows([{ assetId: "a", content: tricky }], [video], ctx).rows, { bom: false });
    expect(csv).toContain('"Patio, ""sandstone""\nPutney"');
  });
});

describe("withUtm", () => {
  it("preserves existing params", () => {
    expect(withUtm("https://x.test/p?a=1", { utm_source: "google" })).toBe("https://x.test/p?a=1&utm_source=google");
  });
});

describe("social exports", () => {
  it("lists captions, normalised hashtags and public image URLs in carousel order", () => {
    const text = socialPackText(patioSocial, [{ mediaId: "med_patio_a1", url: "https://app/x.jpg" }], {
      title: "Patio",
      jobCode: "TL-5937",
    });
    expect(text).toContain("#putneygardens #indiansandstone");
    expect(text).toContain("1. https://app/x.jpg");
    expect(text).toContain("REEL COVER TEXT\nPutney patio");
  });
  it("describes the GBP post and its button", () => {
    const text = gbpPostText(patioGbp, null, { title: "Patio", jobCode: "TL-5937" });
    expect(text).toContain("Button: BOOK → https://www.thorburnlandscapes.co.uk/contact/");
    expect(text).toContain("Photo: none");
  });
});
