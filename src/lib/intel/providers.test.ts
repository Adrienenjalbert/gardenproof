import { describe, expect, it } from "vitest";
import { badgeBodiesIn, detectProvider, socialNetworkOf } from "./providers";

describe("detectProvider", () => {
  it.each([
    ["https://trustedtraders.which.co.uk/businesses/thorburn-landscapes-ltd/", "which", true],
    ["https://trustedtraders.which.co.uk/landscape-contractors-in-south-london/", "which", false],
    ["https://www.checkatrade.com/trades/thorburnlandscapesltd", "checkatrade", true],
    ["https://www.checkatrade.com/Search/Landscaper/in/Portland", "checkatrade", false],
    ["https://www.trustmark.org.uk/firms/Thorburn%20Landscapes-999505-SW19%203NW?id=80d3", "trustmark", true],
    ["https://www.trustpilot.com/review/fangornlandscapes.co.uk", "trustpilot", true],
    ["https://uk.trustpilot.com/categories/landscaping", "trustpilot", false],
    ["https://www.houzz.com/professionals/landscape-architect/ealing-z18-gb-probr0-bo~t_11788", "houzz", false],
    ["https://www.facebook.com/ThorburnGardenServices/", "facebook", true],
    ["https://www.facebook.com/p/Thorburn-Landscapes-Ltd-100054484118566/", "facebook", true],
    ["https://www.facebook.com/BALILandscapeUK/videos/bali-membership/855601142844683/", "facebook", false],
    ["https://find-and-update.company-information.service.gov.uk/company/09013186", "companies_house", true],
    ["https://www.google.com/maps/search/?api=1&query=Thorburn", "google", true],
    ["https://www.google.com/search?q=thorburn", "google", false],
    ["https://www.yell.com/biz/thorburn-landscapes-london-123/", "yell", true],
  ])("%s → %s (profile: %s)", (url, id, isProfile) => {
    expect(detectProvider(url)).toMatchObject({ id, isProfile });
  });

  it("maps providers to review sources and accrediting bodies", () => {
    expect(detectProvider("https://trustedtraders.which.co.uk/businesses/x/")).toMatchObject({ review: "which", badge: "which" });
    expect(detectProvider("https://www.trustmark.org.uk/firms/x")).toMatchObject({ review: null, badge: "trustmark" });
    expect(detectProvider("https://www.facebook.com/x/")).toMatchObject({ scrapable: false });
    expect(detectProvider("https://thorburnlandscapes.co.uk/")).toBeNull();
    expect(detectProvider("not a url")).toBeNull();
  });
});

describe("socialNetworkOf", () => {
  it("recognises networks by host", () => {
    expect(socialNetworkOf("https://www.instagram.com/thorburn.landscapes/")).toBe("instagram");
    expect(socialNetworkOf("https://x.com/someone")).toBe("x");
    expect(socialNetworkOf("https://thorburnlandscapes.co.uk/")).toBeNull();
  });
});

describe("badgeBodiesIn", () => {
  it("finds bodies by full name, and acronyms only in capitals", () => {
    expect(badgeBodiesIn("Backed by Which Trusted Traders, Checkatrade, APL and HTA")).toEqual(["which", "checkatrade", "apl", "hta"]);
    expect(badgeBodiesIn("members of the Association of Professional Landscapers")).toEqual(["apl"]);
    expect(badgeBodiesIn("We holidayed in Bali and liked the apple trees")).toEqual([]);
    expect(badgeBodiesIn("TrustMark Government Endorsed Quality")).toEqual(["trustmark"]);
  });
});
