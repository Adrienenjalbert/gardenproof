import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { bodiesMentioned, collectBadgeImages, decideBadges, identifyByFingerprint, identifyByText, type BodyListing, type SiteBadge } from "./badges";
import { logoFingerprint } from "./images";

const SITE = "https://thorburnlandscapes.co.uk/";
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "__fixtures__", "badges", name));

const siteBadge = (body: SiteBadge["body"], name: string, imageUrl: string | null = null): SiteBadge => ({
  body,
  name,
  imageUrl,
  imageKey: imageUrl ? `intel/x/badges/${body}.png` : null,
  evidenceUrl: SITE,
  how: imageUrl ? "Logo shown on your website" : "Mentioned on your website",
});
const listing = (body: BodyListing["body"], profileUrl: string, matched = true, confidence = 0.9): BodyListing => ({ body, profileUrl, matched, confidence, note: "Profile", rating: null, reviewCount: null });

describe("decideBadges", () => {
  it("verifies a badge only from a matched listing on the body's own site", () => {
    const badges = decideBadges({
      siteUrl: SITE,
      site: [siteBadge("which", "Which? Trusted Trader", "https://thorburnlandscapes.co.uk/which.png"), siteBadge("hta", "HTA Member", "https://thorburnlandscapes.co.uk/hta.png")],
      listings: [{ ...listing("which", "https://trustedtraders.which.co.uk/businesses/thorburn-landscapes-ltd/"), rating: 5, reviewCount: 9 }],
    });
    const which = badges.find((b) => b.body === "which")!;
    expect(which).toMatchObject({ status: "verified", verified: true, rating: 5, reviewCount: 9, imageUrl: "https://thorburnlandscapes.co.uk/which.png" });
    expect(which.evidence[0].url).toContain("trustedtraders.which.co.uk");
    expect(badges.find((b) => b.body === "hta")).toMatchObject({ status: "claimed", verified: false, profileUrl: null });
  });

  it("keeps it claimed when the listing belongs to someone else or the match is weak", () => {
    const badges = decideBadges({
      siteUrl: SITE,
      site: [siteBadge("checkatrade", "Checkatrade", "https://thorburnlandscapes.co.uk/cat.png")],
      listings: [listing("checkatrade", "https://www.checkatrade.com/trades/someoneelse", false), listing("checkatrade", "https://www.checkatrade.com/trades/maybe", true, 0.4)],
    });
    expect(badges).toHaveLength(1);
    expect(badges[0]).toMatchObject({ status: "claimed", verified: false });
    expect(badges[0].evidence.map((e) => e.url)).not.toContain("https://www.checkatrade.com/trades/someoneelse");
  });

  it("never treats the business's own site as the body's site", () => {
    const badges = decideBadges({ siteUrl: SITE, site: [], listings: [listing("trustmark", "https://thorburnlandscapes.co.uk/trustmark/")] });
    expect(badges).toEqual([]);
  });

  it("adds verified badges found only on the body's site (without inventing a logo) and orders verified first", () => {
    const badges = decideBadges({
      siteUrl: SITE,
      site: [siteBadge("safecontractor", "SafeContractor Approved", "https://thorburnlandscapes.co.uk/sc.png")],
      listings: [listing("trustmark", "https://www.trustmark.org.uk/firms/x")],
      thirdParty: [{ body: "apl", url: "https://trustedtraders.which.co.uk/businesses/x/", note: "Mentioned on Which? Trusted Traders" }],
    });
    expect(badges.map((b) => [b.body, b.status])).toEqual([
      ["trustmark", "verified"],
      ["apl", "claimed"],
      ["safecontractor", "claimed"],
    ]);
    expect(badges[0].imageUrl).toBeNull();
  });
});

describe("badge recognition", () => {
  it("identifies bodies from alt text, file names and links", () => {
    expect(identifyByText({ alt: "Which? Trusted Trader logo" })).toBe("which");
    expect(identifyByText({ src: "https://x.co.uk/uploads/apl-member-2024.png" })).toBe("apl");
    expect(identifyByText({ src: "https://x.co.uk/Logo-250-x-150-4.png", href: "https://www.checkatrade.com/trades/x" })).toBe("checkatrade");
    expect(identifyByText({ src: "https://x.co.uk/uploads/Logo-250-x-150-4.png" })).toBeNull();
    expect(identifyByText({ src: "https://x.co.uk/uploads/whichever.png" })).toBeNull();
  });

  it("recognises known logos by fingerprint, even resized and padded", async () => {
    for (const [file, body] of [["which.png", "which"], ["checkatrade.png", "checkatrade"], ["trustmark.png", "trustmark"]] as const) {
      const variant = await sharp(fixture(file)).resize(140).extend({ top: 18, bottom: 18, left: 24, right: 24, background: "#ffffff" }).png().toBuffer();
      expect(identifyByFingerprint(await logoFingerprint(variant))?.body).toBe(body);
    }
  });

  it("does not recognise a random photo as a badge", async () => {
    const noise = await sharp({ create: { width: 200, height: 120, channels: 3, background: "#6a8f3c" } })
      .composite([{ input: Buffer.from('<svg width="200" height="120"><circle cx="60" cy="60" r="40" fill="#fff"/></svg>'), top: 0, left: 0 }])
      .png()
      .toBuffer();
    expect(identifyByFingerprint(await logoFingerprint(noise))).toBeNull();
  });

  it("collects small logo images and skips the site logo, photos and menu images", () => {
    const html = `<header><img src="/logo.png" width="130" height="80"></header>
      <nav><img src="/menu-icon.png" width="20"></nav>
      <div class="row"><img src="/wp-content/Logo-250-x-150-4.png" width="250" height="150" alt=""><img src="/wp-content/safecontractor.png" width="301" height="167"></div>
      <img src="/wp-content/IMG_20210910_100412.jpg" width="1080" height="1080"><img src="/wp-content/hampton-7-200x220.jpg" width="200" height="220">
      <img src="/wp-content/logo.webp" width="130" height="80">`;
    const found = collectBadgeImages(html, SITE, { logoUrl: "https://thorburnlandscapes.co.uk/logo.png" }).map((c) => c.src);
    expect(found).toEqual(["https://thorburnlandscapes.co.uk/wp-content/Logo-250-x-150-4.png", "https://thorburnlandscapes.co.uk/wp-content/safecontractor.png"]);
  });

  it("reads claims from page text but not from image URLs", () => {
    expect(bodiesMentioned("We've earned a 4.9-star rating as a Which? Trusted Trader. ![](https://x.co.uk/safecontractor-logo.png)")).toEqual(["which"]);
  });
});
