/**
 * End to end on replayed Firecrawl fixtures: pipeline → onboarding_runs → confirm → tenants.profile.
 * No network: Firecrawl is faked, image downloads are synthesised, place lookups are off.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { fakeFirecrawl } from "./__fixtures__/fake-firecrawl";
import { buildProfile } from "./pipeline";
import { confirmOnboarding, getOnboardingRun, OnboardingError, runOnboarding, startOnboarding } from "./runs";
import { BusinessProfileSchema, type BusinessProfile } from "./types";

const badge = (f: string) => fs.readFileSync(path.join(__dirname, "__fixtures__", "badges", f));
let photo: Buffer;

/** Badge logos from fixtures (by the site's file names), a synthetic JPEG for any photo, nothing else. */
async function download(url: string): Promise<Buffer | null> {
  if (url.endsWith("Logo-250-x-150.png")) return badge("trustmark.png");
  if (url.endsWith("Logo-250-x-150-9.png")) return badge("which.png");
  if (url.endsWith("Logo-250-x-150-4.png")) return badge("checkatrade.png");
  if (url.endsWith("logo-header1.png")) return badge("which.png");
  if (/\.jpe?g$/i.test(url)) return photo;
  return null;
}

let profile: BusinessProfile;

beforeAll(async () => {
  photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#5d7f3a" } }).jpeg().toBuffer();
  const res = await buildProfile("https://thorburnlandscapes.co.uk/", { fc: fakeFirecrawl(), download, now: () => new Date("2026-09-24T10:00:00Z") });
  profile = res.profile;
}, 120_000);

describe("buildProfile (Thorburn fixtures)", () => {
  it("produces a schema-valid profile with the business's facts", () => {
    expect(BusinessProfileSchema.safeParse(profile).success).toBe(true);
    expect(profile).toMatchObject({
      name: "Thorburn Landscapes",
      legalName: "Thorburn Landscapes Limited",
      companyNumber: "09013186",
      yearsTrading: 14,
      contact: { phone: "020 8064 1303", email: "info@thorburnlandscapes.co.uk", postcode: "SW19 3NW" },
      cta: { text: "Get a Quote", url: "https://thorburnlandscapes.co.uk/contact/" },
    });
    expect(profile.brand.colors).toMatchObject({ primary: "#2A7D2E", secondary: "#F1D2A9", text: "#0B3D2C" });
    expect(profile.services.map((s) => s.label)).toEqual(["Landscaping", "Garden Design", "Garden Maintenance"]);
    expect(profile.areas.map((a) => a.name)).toEqual(expect.arrayContaining(["Wimbledon", "Putney", "Clapham", "Kingston upon Thames"]));
    expect(profile.shell.navLinks.map((l) => l.label)).toEqual(["Services", "Gallery", "Locations", "About", "Contact"]);
    expect(profile.shell.headerHtml).toContain("gp-shell-header");
  });

  it("verifies badges on the bodies' own sites and keeps the rest claimed", () => {
    const status = Object.fromEntries(profile.badges.map((b) => [b.body, b.status]));
    expect(status).toMatchObject({ which: "verified", trustmark: "verified", checkatrade: "verified", apl: "verified", hta: "claimed" });
    const which = profile.badges.find((b) => b.body === "which")!;
    expect(which.imageUrl).toBe("https://thorburnlandscapes.co.uk/wp-content/uploads/2025/05/Logo-250-x-150-9.png");
    expect(which.imageKey).toMatch(/^intel\/thorburn-landscapes\/badges\//);
    expect(which.profileUrl).toBe("https://trustedtraders.which.co.uk/businesses/thorburn-landscapes-ltd/");
  });

  it("aggregates only sources with both a rating and a count, and never invents Google data", () => {
    expect(profile.reviews.aggregate).toEqual({ rating: 5, count: 55 });
    expect(profile.reviews.featured.length).toBeGreaterThanOrEqual(3);
    expect(profile.reviews.featured.length).toBeLessThanOrEqual(6);
    expect(profile.warnings.join(" ")).toMatch(/Connect your Google Business Profile/);
  });

  it("rejects the Duns look-alike with a reason", () => {
    expect(profile.rejected.find((r) => r.url.includes("ThorburnGardenServices"))?.reason).toMatch(/Duns/);
  });

  it("collects projects with stored photos and never uses client names", () => {
    expect(profile.projects.length).toBeGreaterThanOrEqual(4);
    const wimbledon = profile.projects.find((p) => p.title === "Garden Design Wimbledon")!;
    expect(wimbledon).toMatchObject({ area: "Wimbledon", category: "Landscaping & Garden Design" });
    expect(wimbledon.images.length).toBeGreaterThan(0);
    expect(wimbledon.images[0]).toMatchObject({ width: 1200, height: 900 });
    expect(JSON.stringify(profile.projects)).not.toMatch(/Suwun|John and Anne|Garden Owner/i);
  });
});

describe("onboarding runs", () => {
  const lookup = async () => ["92.205.144.189"];

  it("rejects non-public addresses before queueing anything", async () => {
    await expect(startOnboarding("https://192.168.0.10/", { lookup })).rejects.toBeInstanceOf(OnboardingError);
    await expect(startOnboarding("nonsense", { lookup })).rejects.toThrow(/web address/);
  });

  it("queues, runs with progress, and confirms into a new tenant", async () => {
    const { runId } = await startOnboarding("thorburnlandscapes.co.uk", { lookup });
    const db = await getDb();
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.dedupeKey, `intel.onboard:${runId}`));
    expect(task).toMatchObject({ type: "intel.onboard", payload: { runId } });
    expect((await getOnboardingRun(runId))?.steps.map((s) => s.label)).toEqual([
      "Reading your website", "Finding your brand", "Collecting your projects", "Searching for your reviews", "Checking your badges", "Putting it together",
    ]);

    await runOnboarding(runId, { fc: fakeFirecrawl(), download, places: { outwardFor: async () => null, postcodeInfo: async () => null } });
    const run = await getOnboardingRun(runId);
    expect(run?.status).toBe("ready");
    expect(run?.steps.every((s) => s.status === "done")).toBe(true);
    expect(run?.profile?.name).toBe("Thorburn Landscapes");

    await expect(runOnboarding(runId, { fc: fakeFirecrawl([]) })).resolves.toBeUndefined(); // idempotent: ready runs are left alone

    const hta = run!.profile!.badges.find((b) => b.body === "hta")!;
    const which = run!.profile!.reviews.sources.find((s) => s.provider === "which")!;
    const confirmed = await confirmOnboarding(runId, {
      tagline: "Garden design and landscaping in south-west London",
      badges: [{ ...hta, verified: true, status: "verified" }], // owner can't self-verify
      reviews: { sources: [{ ...which, rating: 4.1, count: 900 }], featured: [] }, // nor change numbers
    });
    expect(confirmed.slug).toBe("thorburn-landscapes");
    expect(confirmed.profile.tagline).toBe("Garden design and landscaping in south-west London");
    expect(confirmed.profile.badges).toEqual([expect.objectContaining({ body: "hta", status: "claimed", verified: false })]);
    expect(confirmed.profile.reviews.sources).toEqual([expect.objectContaining({ provider: "which", rating: 5, count: 9 })]);
    expect(confirmed.profile.reviews.aggregate).toEqual({ rating: 5, count: 9 });

    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, confirmed.tenantId));
    expect(tenant.profile?.name).toBe("Thorburn Landscapes");
    expect(tenant.config.brand.primary).toBe("#2A7D2E");
    expect((await getOnboardingRun(runId))?.status).toBe("confirmed");
    await expect(confirmOnboarding(runId, {})).rejects.toMatchObject({ code: "conflict" });
  }, 120_000);

  it("refuses unknown edit fields", async () => {
    const { runId } = await startOnboarding("https://thorburnlandscapes.co.uk/", { lookup });
    await expect(confirmOnboarding(runId, { hacked: true })).rejects.toMatchObject({ code: "invalid_edits" });
    await expect(confirmOnboarding(runId, {})).rejects.toMatchObject({ code: "not_ready" });
  });
});

describe("saved Thorburn profile", () => {
  it("data/profiles/thorburn-landscapes.json validates when present", () => {
    const file = path.join(process.cwd(), "data", "profiles", "thorburn-landscapes.json");
    if (!fs.existsSync(file)) return;
    expect(BusinessProfileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8"))).success).toBe(true);
  });
});
