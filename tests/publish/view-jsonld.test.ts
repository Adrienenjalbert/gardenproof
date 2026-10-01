import { describe, expect, it } from "vitest";
import { buildArticleJsonLd, buildPortfolioJsonLd, serializeJsonLd } from "@/lib/publish/jsonld";
import { buildArticleView, buildPortfolioView, type MediaInput, type ViewContext } from "@/lib/publish/view";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { patioArticle, patioPage, pondPage } from "../fixtures/mod-d";

const media: MediaInput[] = [
  { id: "med_patio_a1", stage: "after", kind: "image", publicKey: "t/patio.jpg", width: 1280, height: 720 },
  { id: "med_pond_b1", stage: "before", kind: "image", publicKey: "t/pond-b.jpg", width: 720, height: 720 },
  { id: "med_pond_a1", stage: "after", kind: "image", publicKey: "t/pond-a.jpg", width: 720, height: 720 },
  { id: "med_private", stage: "after", kind: "image", publicKey: null, width: 1, height: 1 },
];
const ctx: ViewContext = {
  assetId: "ast_1",
  config: THORBURN_CONFIG,
  appUrl: "https://app.example",
  mediaUrl: (k) => `https://app.example/api/media/${k}`,
};
type Node = Record<string, unknown>;
const types = (g: { "@graph": Node[] }) => g["@graph"].map((n) => n["@type"]);

describe("buildPortfolioView", () => {
  it("uses the after photo as hero and keeps it out of the gallery", () => {
    const v = buildPortfolioView(pondPage, media, ctx);
    expect(v.hero?.mediaId).toBe("med_pond_a1");
    expect(v.beforeAfter?.before.mediaId).toBe("med_pond_b1");
    expect(v.gallery).toEqual([]);
    expect(v.canonicalUrl).toBe("https://www.thorburnlandscapes.co.uk/projects/pond-gravel-garden-wimbledon/");
  });

  it("never exposes media without a public-safe derivative", () => {
    const content = { ...patioPage, gallery: [{ mediaId: "med_private", stage: "after" as const, alt: "x" }] };
    const v = buildPortfolioView(content, media, ctx);
    expect(v.hero).toBeNull();
    expect(JSON.stringify(v)).not.toContain("med_private");
  });

  it("drops the comparison when either photo is missing", () => {
    const v = buildPortfolioView({ ...pondPage, beforeAfter: { beforeMediaId: "nope", afterMediaId: "med_pond_a1" } }, media, ctx);
    expect(v.beforeAfter).toBeNull();
  });

  it("prefers the live WordPress URL as canonical", () => {
    const v = buildPortfolioView(patioPage, media, { ...ctx, canonicalUrl: "https://site.test/projects/x/" });
    expect(v.canonicalUrl).toBe("https://site.test/projects/x/");
    expect(buildPortfolioView(patioPage, media, { ...ctx, canonicalUrl: "/preview/ast_1" }).canonicalUrl).toContain(
      "thorburnlandscapes.co.uk/projects/",
    );
  });
});

describe("buildPortfolioJsonLd", () => {
  it("emits Service, LocalBusiness reference, ImageObject, BreadcrumbList, FAQPage and a Review for a real rating", () => {
    const g = buildPortfolioJsonLd(buildPortfolioView(patioPage, media, ctx));
    expect(types(g)).toEqual(
      expect.arrayContaining(["WebPage", "LocalBusiness", "Service", "ImageObject", "BreadcrumbList", "Review", "FAQPage"]),
    );
    const review = g["@graph"].find((n) => n["@type"] === "Review")!;
    expect(review.reviewRating).toMatchObject({ ratingValue: 5, bestRating: 5 });
    expect(review.author).toEqual({ "@type": "Person", name: "James P., Putney" });
    const service = g["@graph"].find((n) => n["@type"] === "Service")!;
    expect(service.provider).toEqual({ "@id": "https://www.thorburnlandscapes.co.uk/#business" });
    expect(service.areaServed).toEqual({ "@type": "Place", name: "Putney" });
    const crumbs = g["@graph"].find((n) => n["@type"] === "BreadcrumbList")!.itemListElement as Node[];
    expect(crumbs.map((c) => c.item)).toEqual([
      "https://www.thorburnlandscapes.co.uk/",
      "https://www.thorburnlandscapes.co.uk/projects/",
      "https://www.thorburnlandscapes.co.uk/projects/indian-sandstone-circle-patio-putney/",
    ]);
  });

  it("emits no Review or AggregateRating without a testimonial", () => {
    const g = buildPortfolioJsonLd(buildPortfolioView(pondPage, media, ctx));
    expect(types(g)).not.toContain("Review");
    expect(JSON.stringify(g)).not.toMatch(/AggregateRating|reviewRating|ratingValue/);
  });

  it("emits no FAQPage when there are no FAQs, and de-duplicates images", () => {
    const g = buildPortfolioJsonLd(buildPortfolioView({ ...pondPage, faqs: [] }, media, ctx));
    expect(types(g)).not.toContain("FAQPage");
    expect(types(g).filter((t) => t === "ImageObject")).toHaveLength(2);
  });

  it("serialises safely inside a script tag", () => {
    const view = buildPortfolioView({ ...patioPage, h1: "</script><script>alert(1)</script>" }, media, ctx);
    const out = serializeJsonLd(buildPortfolioJsonLd(view));
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out)["@graph"][2].name).toBe("</script><script>alert(1)</script>");
  });
});

describe("buildArticleJsonLd", () => {
  it("builds Article + breadcrumbs + FAQPage and renders the body safely", () => {
    const v = buildArticleView(patioArticle, [{ title: "Putney patio", url: "https://x.test/projects/p/" }], ctx);
    expect(v.bodyHtml).toContain("<h2>Laying patterns</h2>");
    expect(v.canonicalUrl).toBe("https://www.thorburnlandscapes.co.uk/advice/indian-sandstone-patio-ideas-putney/");
    expect(types(buildArticleJsonLd(v))).toEqual(["Article", "LocalBusiness", "BreadcrumbList", "FAQPage"]);
  });
});
