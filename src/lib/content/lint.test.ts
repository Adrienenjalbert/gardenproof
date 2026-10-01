import { describe, expect, it } from "vitest";
import { THORBURN_CONFIG } from "@/lib/tenant";
import {
  checkBanned,
  checkBritish,
  checkClaims,
  checkCtaPunctuation,
  checkExclamations,
  checkGrammar,
  checkPrivacy,
  checkQuotes,
  checkRepetition,
  checkSlug,
  collectText,
  lintAsset,
  lintPassed,
  isVerbatimQuote,
  numbersIn,
} from "./lint";
import type { Check, LintContext } from "./types";

const ctx: LintContext = {
  bannedPhrases: THORBURN_CONFIG.voice.dontSay,
  mediaIds: ["m_before", "m_after"],
  sourceText: "Indian sandstone patio, two curved brick raised beds, timber pergola. Took two and a half weeks.\nrated 4.9",
  rating: 5,
  quote: "Exactly what we pictured.",
  ctaText: "Book a design consultation",
  whichRating: "4.9",
  areaNamed: true,
  outwardCode: "SW15",
  forbidden: [{ term: "Patel", reason: "customer surname is never public" }],
  year: 2026,
};

const page = {
  slug: "indian-sandstone-patio-putney-2026",
  seoTitle: "Indian sandstone patio & raised beds, Putney | Thorburn",
  metaDescription: "An Indian sandstone patio with curved brick raised beds and a timber pergola in Putney. Two and a half weeks from start to finish.",
  h1: "Indian sandstone patio and curved brick raised beds in Putney",
  summary: "An Indian sandstone patio with curved brick raised beds and a timber pergola, built for a Putney garden.",
  sections: { brief: "Patio.", challenge: "Circles.", solution: "Sandstone.", result: "Done." },
  facts: { service: "Patios & paving", area: "Putney", materials: ["Indian sandstone"], features: ["patio"], duration: "Two and a half weeks" },
  testimonial: { quote: "Exactly what we pictured.", attribution: "James, Putney", rating: 5 },
  gallery: [{ mediaId: "m_after", stage: "after", alt: "Finished Indian sandstone patio in Putney" }],
  beforeAfter: { beforeMediaId: "m_before", afterMediaId: "m_after" },
  faqs: [],
  cta: { text: "Book a design consultation", url: "https://www.thorburnlandscapes.co.uk/contact/" },
  internalLinks: [],
};

const byId = (checks: Check[], id: string) => checks.find((c) => c.id === id);

describe("lintAsset", () => {
  it("passes a clean portfolio page", () => {
    const checks = lintAsset("portfolio_page", page, ctx);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(lintPassed(checks)).toBe(true);
  });

  it("reports schema failures without throwing", () => {
    const checks = lintAsset("portfolio_page", { ...page, seoTitle: "x".repeat(80) }, ctx);
    expect(byId(checks, "schema")?.ok).toBe(false);
    expect(byId(checks, "lengths")?.message).toMatch(/SEO title is 80 chars/);
  });

  it("flags gallery media that do not belong to the job and weak alt text", () => {
    const checks = lintAsset("portfolio_page", { ...page, gallery: [{ mediaId: "m_other", stage: "after", alt: "image.jpg" }] }, ctx);
    expect(byId(checks, "media-ids")?.ok).toBe(false);
    expect(byId(checks, "alt-text")?.ok).toBe(false);
  });

  it("fails consent when a testimonial appears without a consented rating or quote", () => {
    expect(byId(lintAsset("portfolio_page", page, { ...ctx, rating: null }), "consent")?.ok).toBe(false);
    expect(byId(lintAsset("portfolio_page", page, { ...ctx, quote: null }), "consent")?.ok).toBe(false);
  });

  it("fails consent when the testimonial block edits the homeowner's words", () => {
    const edited = { ...page, testimonial: { ...page.testimonial, quote: "Exactly what we wanted." } };
    expect(byId(lintAsset("portfolio_page", edited, ctx), "consent")?.message).toMatch(/verbatim/);
  });

  it("flags a quote cut to fit an ad field (QA B1)", () => {
    const quote = "Marco's team turned a jungle into the garden we'd hoped for — the pond is the first thing we see every morning.";
    const ad = {
      meta: {
        hooks: ["a b", "c d", "e f"],
        primaryTexts: ["“Marco's team turned a jungle into the garden we'd hoped for — the pond is the first thing” – Harriet, Wimbledon", "b", "c"],
        headlines: ["a", "b", "c"],
      },
      pmax: { headlines: ["a", "b", "c"], longHeadlines: ["x"], descriptions: ["x", "y"] },
      angle: "proof",
    };
    expect(byId(lintAsset("ad_copy", ad, { ...ctx, quote }), "quote-verbatim")).toMatchObject({ ok: false, message: expect.stringMatching(/verbatim/) });
  });

  it("enforces ad platform limits (hooks ≤ 6 words, PMax headline ≤ 30)", () => {
    const ad = {
      meta: {
        hooks: ["Patio specialist in Putney?", "This hook is far too long for a video", "Finished in two and a half weeks"],
        primaryTexts: ["a", "b", "Book a design consultation."],
        headlines: ["a", "b", "c"],
      },
      pmax: { headlines: ["a", "b", "c"], longHeadlines: ["x"], descriptions: ["x", "y"] },
      angle: "craft",
    };
    const checks = lintAsset("ad_copy", ad, ctx);
    expect(byId(checks, "lengths")?.message).toMatch(/hook 2 has 9 words.*hook 3 has 7 words/);
    expect(byId(checks, "cta")?.ok).toBe(true);
  });

  it("requires 2+ related projects and a CTA on area articles", () => {
    const article = {
      slug: "patios-and-paving-putney",
      seoTitle: "Patios & paving in Putney",
      metaDescription: "Two finished patios & paving projects in Putney by Thorburn Landscapes, using Indian sandstone.",
      h1: "Patios & paving in Putney",
      targetKeyword: "patio putney",
      bodyMarkdown: "Short.",
      relatedJobIds: ["job_1"],
      faqs: [],
    };
    const checks = lintAsset("seo_article", article, { ...ctx, areaNamed: true });
    expect(byId(checks, "cluster")?.ok).toBe(false);
    expect(byId(checks, "lengths")?.message).toMatch(/thin/);
    expect(byId(checks, "cta")?.ok).toBe(false);
  });
});

describe("individual rules", () => {
  it("banned phrases (case-insensitive, punctuation phrases too)", () => {
    expect(checkBanned("A true OASIS in the city", THORBURN_CONFIG.voice.dontSay).ok).toBe(false);
    expect(checkBanned("Wow!! amazing", THORBURN_CONFIG.voice.dontSay).message).toMatch(/"!!"/);
    expect(checkBanned("Elevated planters", ["elevate"]).ok).toBe(false);
    expect(checkBanned("A calm gravel terrace", THORBURN_CONFIG.voice.dontSay).ok).toBe(true);
  });

  it("British spelling spot-checks", () => {
    expect(checkBritish("Warm color palette").message).toMatch(/colour/);
    expect(checkBritish("Our favorite backyard").ok).toBe(false);
    expect(checkBritish("We specialize in patios").ok).toBe(false);
    expect(checkBritish("Warm colour, centre, favourite, neighbour, grey").ok).toBe(true);
  });

  it("exclamation spam", () => {
    expect(checkExclamations("Lovely!").ok).toBe(true);
    expect(checkExclamations("Lovely! Great!").ok).toBe(false);
    expect(checkExclamations("Lovely!!").ok).toBe(false);
  });

  it("grammar slips from templates", () => {
    expect(checkGrammar("an and a yew hedge").ok).toBe(false);
    expect(checkGrammar("oak sleeper caps and and fitted").ok).toBe(false);
    expect(checkGrammar("a Indian sandstone patio").ok).toBe(false);
    expect(checkGrammar("the two raised beds and an hour of work, a European maple").ok).toBe(true);
  });

  it("privacy: postcodes, addresses, forbidden names, outward code consent", () => {
    const p = (text: string, over: Partial<LintContext> = {}, slug: string | null = null) => checkPrivacy(text, slug, { ...ctx, ...over });
    expect(p("A garden at SW15 2QT").ok).toBe(false);
    expect(p("Finished at 14 Acacia Road").ok).toBe(false);
    expect(p("Just off Oxford Street").ok).toBe(false);
    expect(p("Flat 3 garden").ok).toBe(false);
    expect(p("Our Putney (SW15) project").ok).toBe(true);
    expect(p("Our Putney (SW19) project").ok).toBe(false);
    expect(p("A project in SW15", { areaNamed: false, outwardCode: null }).ok).toBe(false);
    expect(p("Thanks to Mr Patel").ok).toBe(false);
    expect(p("A patio", { forbidden: [{ term: "Putney", reason: "no area consent" }] }, "patio-putney-2026").ok).toBe(false);
    expect(p("Raynes Park and Richmond Park").ok).toBe(true);
  });

  it("claims: ratings and numbers must trace to the source", () => {
    const c = (text: string, over: Partial<LintContext> = {}) => checkClaims(text, { ...ctx, ...over });
    expect(c("A 5-star finish").ok).toBe(true);
    expect(c("A 5-star finish", { rating: 4 }).ok).toBe(false);
    expect(c("Rated 4.9 on Which?").ok).toBe(true);
    expect(c("Rated 4.8 on Which?").ok).toBe(false);
    expect(c("The homeowner rated it 5 out of 5").ok).toBe(true);
    expect(c("Two and a half weeks from start to finish").ok).toBe(true);
    expect(c("Finished in 3 weeks").ok).toBe(false);
    expect(c("Finished in three weeks").ok).toBe(false);
    expect(c("Over 20 years of experience").ok).toBe(false);
    expect(c("An award-winning team").message).toMatch(/award-winning/);
    expect(c("Completed in 2026").ok).toBe(true);
  });

  it("numbersIn reads digits and number words with units, ignoring urls and outward codes", () => {
    expect(numbersIn("two and a half weeks, 3 days, SW15, https://x.co/2027, #Top10")).toEqual([3, 2.5]);
  });

  it("slug format", () => {
    expect(checkSlug("indian-sandstone-patio-putney-2026").ok).toBe(true);
    expect(checkSlug("Indian Sandstone").ok).toBe(false);
    expect(checkSlug("double--hyphen").ok).toBe(false);
  });

  it("quote-verbatim: whole quote or whole sentences only; nothing quoted without consent", () => {
    const quote = "The team were careful with everything. It feels like a new room.";
    expect(isVerbatimQuote(quote, quote)).toBe(true);
    expect(isVerbatimQuote("It feels like a new room", quote)).toBe(true);
    expect(isVerbatimQuote("The team were careful with everything.", quote)).toBe(true);
    expect(isVerbatimQuote("The team were careful", quote)).toBe(false);
    expect(isVerbatimQuote("feels like a new room", quote)).toBe(false);
    expect(isVerbatimQuote("The team were very careful with everything.", quote)).toBe(false);
    expect(checkQuotes(`“${quote}” – Sophie, Putney`, quote).ok).toBe(true);
    expect(checkQuotes("“The team were careful” – Sophie", quote).ok).toBe(false);
    expect(checkQuotes("“Lovely job, very neat” – Olivia", null).message).toMatch(/no consented/);
    expect(checkQuotes("A “York stone” terrace", null).ok).toBe(true); // short quoted terms are not quotes
  });

  it("repetition: the same phrase twice in one sentence (QA B3)", () => {
    expect(checkRepetition("The brief was a garden design built around a garden design.").message).toMatch(/"garden design"/);
    expect(checkRepetition("Garden design in Putney. More garden design work nearby.").ok).toBe(true);
    expect(checkRepetition("An Indian sandstone patio with a red brick band and a timber pergola.").ok).toBe(true);
  });

  it("cta-punctuation: the CTA starts its own sentence (QA B9)", () => {
    const cta = "Book a design consultation";
    expect(checkCtaPunctuation(["“Lovely.” – Harriet, Wimbledon Book a design consultation – link in bio."], cta).ok).toBe(false);
    expect(checkCtaPunctuation(["“Lovely.” – Harriet, Wimbledon\n\nBook a design consultation – link in bio."], cta).ok).toBe(false);
    expect(checkCtaPunctuation(["“Lovely.” – Harriet, Wimbledon.\n\nBook a design consultation – link in bio."], cta).ok).toBe(true);
    expect(checkCtaPunctuation(["Planning a patio? Book a design consultation.", "Book a design consultation", "[Book a design consultation](https://x)"], cta).ok).toBe(true);
    expect(checkCtaPunctuation(["Every project started on site. [Book a design consultation](https://x)."], cta).ok).toBe(true);
  });

  it("collectText skips ids, urls and slugs", () => {
    expect(collectText({ slug: "x-y", mediaId: "m1", cta: { text: "Book", url: "https://a" }, list: ["a", { alt: "b" }] })).toEqual(["Book", "a", "b"]);
  });
});
