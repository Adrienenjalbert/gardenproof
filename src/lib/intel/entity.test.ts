import { describe, expect, it } from "vitest";
import { matchEntity, splitTitle, type BusinessIdentity } from "./entity";

const THORBURN: BusinessIdentity = {
  name: "Thorburn Landscapes",
  legalName: null,
  phones: ["02080641303"],
  emails: ["info@thorburnlandscapes.co.uk"],
  website: "https://thorburnlandscapes.co.uk/",
  postcodes: ["SW19 3NW"],
  outwardCodes: ["SW19", "SW15", "SW4", "KT2", "TW9"],
  places: ["Wimbledon", "Putney", "Clapham", "Kingston upon Thames", "Merton", "London"],
  companyNumber: null,
};

describe("splitTitle", () => {
  it("separates a name from a trailing town and site name", () => {
    expect(splitTitle("Thorburn Garden Services | Duns - Facebook")).toEqual({ name: "Thorburn Garden Services", place: "Duns" });
    expect(splitTitle("Thorburn Landscapes Ltd | London - Facebook")).toEqual({ name: "Thorburn Landscapes Ltd", place: "London" });
    expect(splitTitle("Thorburn Landscapes Ltd - Landscape contractors in London").place).toBeNull();
    expect(splitTitle("thorburn landscapes limited 09013186 - Companies House").name).toBe("thorburn landscapes limited");
  });
});

describe("matchEntity", () => {
  it("rejects the same-surname business in Duns (the known false positive)", () => {
    const title = "Thorburn Garden Services | Duns - Facebook";
    const { name, place } = splitTitle(title);
    const r = matchEntity(THORBURN, {
      url: "https://www.facebook.com/ThorburnGardenServices/",
      name,
      place,
      text: `${title}\nRating 5.0(5)100% recommend (5 reviews) $$. This lawn got a light renovation. These sandstone pavers were a dream for our large surface cleaner.`,
    });
    expect(r.matched).toBe(false);
    expect(r.reason).toMatch(/Duns/);
    expect(r.reason).toMatch(/Thorburn Garden Services/);
  });

  it("accepts a directory page that shows the business's phone and website", () => {
    const r = matchEntity(THORBURN, {
      url: "https://trustedtraders.which.co.uk/businesses/thorburn-landscapes-ltd/",
      name: "Thorburn Landscapes Ltd",
      text: "# Thorburn Landscapes Ltd\n5.0\n9 Reviews\n- [02080641303](tel:02080641303) or [07505671751](tel:07505671751)\n- Thorburn Landscapes Ltd, Zone 1, 35 Wimbledon Hill Rd, Wimbledon, London, SW19 7NB",
      links: ["http://www.thorburnlandscapes.co.uk/"],
    });
    expect(r.matched).toBe(true);
    expect(r.by).toEqual(expect.arrayContaining(["name", "phone", "website"]));
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("accepts the same name in the same area when the page hides contact details, with lower confidence", () => {
    const r = matchEntity(THORBURN, {
      url: "https://www.checkatrade.com/trades/thorburnlandscapesltd",
      name: "Thorburn Landscapes Ltd",
      text: "# Thorburn Landscapes Ltd\n## London\nVerified reviewer\nJob location: SW19\nJob location: KT2",
    });
    expect(r.matched).toBe(true);
    expect(r.by).toEqual(["name"]);
    expect(r.confidence).toBeLessThan(0.8);
  });

  it("rejects a same-name business whose postcode is in another postcode area", () => {
    const r = matchEntity(THORBURN, {
      url: "https://example-directory.co.uk/thorburn-landscapes",
      name: "Thorburn Landscapes",
      text: "Thorburn Landscapes, 4 High Street, Kelso, TD5 7AA",
    });
    expect(r.matched).toBe(false);
    expect(r.reason).toMatch(/TD5 7AA/);
  });

  it("rejects an unrelated name straight away", () => {
    const r = matchEntity(THORBURN, { url: "https://www.trustpilot.com/review/fangornlandscapes.co.uk", name: "Fangorn Landscapes Reviews", text: "Rating 4.7(55)" });
    expect(r).toMatchObject({ matched: false, confidence: 0 });
  });

  it("does not let generic trade words make a match", () => {
    const r = matchEntity(THORBURN, { url: "https://x.example/", name: "Wimbledon Landscapes", text: "Wimbledon Landscapes SW19 3NW" });
    expect(r.matched).toBe(false);
  });

  it("accepts a registry entry with the exact legal name even though the registered office is elsewhere", () => {
    const r = matchEntity(THORBURN, {
      url: "https://find-and-update.company-information.service.gov.uk/company/09013186",
      name: "THORBURN LANDSCAPES LIMITED",
      text: "# THORBURN LANDSCAPES LIMITED\nCompany number **09013186**\nRegistered office address 20 Commerce Road, Lynchwood, Peterborough, United Kingdom, PE2 6LR",
      isRegistry: true,
    });
    expect(r.matched).toBe(true);
  });

  it("treats a same-name page with nothing to confirm or contradict it as unconfirmed, not a look-alike", () => {
    const r = matchEntity(THORBURN, { url: "https://www.instagram.com/thorburn.landscapes/", name: "Thorburn Landscapes", text: "Thorburn Landscapes - Instagram" });
    expect(r).toMatchObject({ matched: false, verdict: "unconfirmed" });
    const duns = matchEntity(THORBURN, { url: "https://www.facebook.com/ThorburnGardenServices/", name: "Thorburn Garden Services", place: "Duns", text: "" });
    expect(duns.verdict).toBe("different_business");
  });

  it("matches on a company number when we know it", () => {
    const r = matchEntity({ ...THORBURN, companyNumber: "09013186" }, { url: "https://x.example/", name: "Thorburn Landscapes Limited", text: "Company No. 09013186" });
    expect(r.by).toContain("company_number");
    expect(r.matched).toBe(true);
  });
});
