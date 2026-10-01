import { describe, expect, it } from "vitest";
import { buildPortfolioView, type MediaInput, type ViewContext } from "@/lib/publish/view";
import { renderPortfolioBodyHtml, toWpArticlePayload, toWpProjectPayload, wpMediaSlug, GP_CONTENT_VERSION } from "@/lib/publish/wp-mappers";
import { buildArticleView } from "@/lib/publish/view";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { patioArticle, patioPage, pondPage } from "../fixtures/mod-d";

const media: MediaInput[] = [
  { id: "med_patio_a1", stage: "after", kind: "image", publicKey: "t/patio.jpg", width: 1280, height: 720 },
  { id: "med_pond_b1", stage: "before", kind: "image", publicKey: "t/pond-b.jpg", width: 720, height: 720 },
  { id: "med_pond_a1", stage: "after", kind: "image", publicKey: "t/pond-a.jpg", width: 720, height: 720 },
];
const ctx: ViewContext = { assetId: "ast_1", config: THORBURN_CONFIG, appUrl: "https://app.example", mediaUrl: (k) => `https://app.example/api/media/${k}` };

describe("toWpProjectPayload", () => {
  it("maps title, slug, excerpt, featured image and structured meta", () => {
    const view = buildPortfolioView(patioPage, media, ctx);
    const payload = toWpProjectPayload({ ...view, hero: { ...view.hero!, wpId: 42 } });
    expect(payload).toMatchObject({
      title: patioPage.h1,
      slug: patioPage.slug,
      status: "publish",
      excerpt: patioPage.summary,
      featured_media: 42,
    });
    const meta = JSON.parse(payload.meta.gp_content);
    expect(meta.version).toBe(GP_CONTENT_VERSION);
    expect(meta.type).toBe("portfolio_page");
    expect(meta.view.facts.area).toBe("Putney");
    expect(meta.jsonLd["@graph"].some((n: { "@type": string }) => n["@type"] === "Review")).toBe(true);
  });

  it("omits featured_media until the hero is uploaded", () => {
    expect(toWpProjectPayload(buildPortfolioView(patioPage, media, ctx))).not.toHaveProperty("featured_media");
  });

  it("renders an escaped, semantic HTML fallback body", () => {
    const view = buildPortfolioView(
      { ...pondPage, summary: 'Cleared <script>x</script> & "rebuilt"', cta: { text: "Book", url: "javascript:alert(1)" } },
      media,
      ctx,
    );
    const html = renderPortfolioBodyHtml(view);
    expect(html).toContain("<p>Cleared &lt;script&gt;x&lt;/script&gt; &amp; &quot;rebuilt&quot;</p>");
    expect(html).toContain("<h2>The challenge</h2>");
    expect(html).toContain('alt="Overgrown garden with long grass');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<blockquote>"); // no testimonial on this job
  });

  it("includes the testimonial and rating when present", () => {
    const html = renderPortfolioBodyHtml(buildPortfolioView(patioPage, media, ctx));
    expect(html).toContain("<cite>James P., Putney · 5/5</cite>");
  });
});

describe("toWpArticlePayload", () => {
  it("uses the rendered markdown and lists related projects", () => {
    const view = buildArticleView(patioArticle, [{ title: "Putney patio", url: "https://x.test/projects/p/" }], ctx);
    const payload = toWpArticlePayload(view);
    expect(payload.content).toContain("<h2>Laying patterns</h2>");
    expect(payload.content).toContain('<a href="https://x.test/projects/p/">Putney patio</a>');
    expect(JSON.parse(payload.meta.gp_content).type).toBe("seo_article");
  });
});

describe("wpMediaSlug", () => {
  it("is stable, lowercase and URL-safe", () => {
    expect(wpMediaSlug("med_Patio.A1")).toBe("gp-med_patio-a1");
  });
});
