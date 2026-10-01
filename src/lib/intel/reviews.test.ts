import { describe, expect, it } from "vitest";
import type { BusinessIdentity } from "./entity";
import { fakeFirecrawl } from "./__fixtures__/fake-firecrawl";
import { buildQueries, companiesHouseFacts, googleMapsFacts, investigateWeb, ratingFromSnippet, searchAll, trustmarkSchemeBodies, verifyProviderFacts } from "./reviews";

const BIZ: BusinessIdentity = {
  name: "Thorburn Landscapes",
  legalName: null,
  phones: ["02080641303"],
  emails: ["info@thorburnlandscapes.co.uk"],
  website: "https://thorburnlandscapes.co.uk/",
  postcodes: ["SW19 3NW"],
  outwardCodes: ["SW19", "SW4", "SW15", "KT1", "KT3"],
  places: ["Wimbledon", "Clapham", "Putney", "Kingston upon Thames", "Merton", "London"],
  companyNumber: null,
};

describe("snippet and page parsers", () => {
  it("reads Google-style rich snippet ratings", () => {
    expect(ratingFromSnippet("Rating 5.0(9)Very happy with the work")).toEqual({ rating: 5, count: 9 });
    expect(ratingFromSnippet("Rating 10/10(74)At Checkatrade")).toEqual({ rating: 5, count: 74 });
    expect(ratingFromSnippet("no rating here")).toBeNull();
  });

  it("reads a Google Maps listing (rating and count, English or comma decimals)", () => {
    expect(googleMapsFacts("See photos\n\n# Thorburn Landscapes\n\n5.0(46)\n\nReviews aren't verified")).toEqual({ name: "Thorburn Landscapes", rating: 5, count: 46 });
    expect(googleMapsFacts("# Thorburn Landscapes\n\n4,7\n\nRezensionen")).toEqual({ name: "Thorburn Landscapes", rating: 4.7, count: null });
  });

  it("reads TrustMark scheme providers and Companies House facts", () => {
    expect(trustmarkSchemeBodies("#### Licence number\n\n![l](x)999505\n\n#### Scheme Provider(s)\n\n![Certificate](y)\n\nAssociation of Professional Landscapers")).toEqual({ bodies: ["apl"], licence: "999505" });
    expect(companiesHouseFacts("# THORBURN LANDSCAPES LIMITED\n\nCompany number\n**09013186**\n\nCompany status\nActive\n\nIncorporated on28 April 2014", "https://find-and-update.company-information.service.gov.uk/company/09013186")).toEqual({
      number: "09013186",
      legalName: "Thorburn Landscapes Limited",
      status: "Active",
      incorporated: "2014-04-28",
      url: "https://find-and-update.company-information.service.gov.uk/company/09013186",
    });
  });
});

describe("verifyProviderFacts", () => {
  const md = "# Thorburn Landscapes Ltd\n\n### 27 total reviews\n\nno overall rating is available.\n\n- 10\n\nPosted 02 December 2019\n\n### New Garden\n\nThorburn landscapes did a great job and my garden is just how I want it.\n\nVerified reviewer";
  it("keeps only numbers and quotes that are on the page, normalised to /5", () => {
    const out = verifyProviderFacts(
      {
        overallRating: 9.8, // not on the page → dropped
        ratingOutOf: 10,
        reviewCount: 27,
        reviews: [
          { author: "Verified reviewer", text: "Thorburn landscapes did a great job and my garden is just how I want it.", rating: 10, ratingOutOf: 10, date: "02 December 2019" },
          { author: "Mrs Invented", text: "An absolutely stunning transformation that never happened on this page.", rating: 10, date: "01 January 2020" },
        ],
      },
      md,
      "checkatrade",
      "https://www.checkatrade.com/trades/thorburnlandscapesltd",
    );
    expect(out.rating).toBeNull();
    expect(out.count).toBe(27);
    expect(out.reviews).toEqual([
      { provider: "checkatrade", author: "Verified reviewer", text: "Thorburn landscapes did a great job and my garden is just how I want it.", rating: 5, date: "2019-12-02", url: "https://www.checkatrade.com/trades/thorburnlandscapesltd" },
    ]);
  });
  it("handles a missing extraction", () => {
    expect(verifyProviderFacts(null, md, "which", "u")).toEqual({ rating: null, count: null, reviews: [] });
  });
});

describe("investigateWeb (Thorburn fixtures)", () => {
  it("matches the real listings, rejects the Duns look-alike and never scrapes Facebook", async () => {
    const fc = fakeFirecrawl();
    const { hits } = await searchAll(fc, buildQueries("Thorburn Landscapes", "Wimbledon"));
    const out = await investigateWeb(fc, BIZ, hits, { googleQuery: "Thorburn Landscapes SW19 3NW" });

    const duns = out.rejected.find((r) => r.url.includes("ThorburnGardenServices"));
    expect(duns?.reason).toMatch(/Duns/);
    expect(fc.calls.some((c) => c.includes("facebook.com"))).toBe(false);

    const which = out.sources.find((s) => s.provider === "which");
    expect(which).toMatchObject({ rating: 5, count: 9 });
    expect(which?.matched.by).toEqual(expect.arrayContaining(["phone", "website"]));
    expect(out.sources.find((s) => s.provider === "checkatrade")).toMatchObject({ rating: null, count: 27 });
    expect(out.sources.find((s) => s.provider === "google")).toMatchObject({ rating: 5, count: 46 });

    expect(out.listings.map((l) => l.body).sort()).toEqual(["apl", "checkatrade", "trustmark", "which"]);
    // Checkatrade had only name + area, but the Google listing links to it → confidence raised.
    expect(out.listings.find((l) => l.body === "checkatrade")?.confidence).toBeGreaterThanOrEqual(0.8);
    expect(out.company).toMatchObject({ number: "09013186", legalName: "Thorburn Landscapes Limited" });
    expect(out.reviews.length).toBeGreaterThanOrEqual(6);
    expect(out.reviews.every((r) => r.text.length > 20 && r.url.startsWith("https://"))).toBe(true);
    expect(out.social).toContainEqual({ network: "facebook", url: "https://www.facebook.com/p/Thorburn-Landscapes-Ltd-100054484118566/" });
  });
});
