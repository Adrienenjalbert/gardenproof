/** P1-6 (held siblings stay out of the ad bundle) and QA B7 (ads land on the job's own project page). */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import type { Job } from "@/db/schema";
import { env } from "@/lib/config";
import { publishAsset } from "@/lib/publish";
import { readManifest } from "@/lib/publish/exports";
import { landingUrl } from "@/lib/publish/handlers";
import { getObject, putObject } from "@/lib/storage";
import { getTenant } from "@/lib/tenants";
import { patioAds, patioPage, patioVideo } from "../fixtures/mod-d";
import { insertAsset, insertJob, seedBase, TENANT_ID } from "../fixtures/mod-d-db";

beforeAll(seedBase, 120_000);

async function job(id: string): Promise<Job> {
  await insertJob(id);
  const [j] = await (await getDb()).select().from(schema.jobs).where(eq(schema.jobs.id, id));
  return j;
}
const privacyFail = [{ id: "privacy", ok: false, message: "Street address in copy" }];

describe("ad bundle siblings (P1-6)", () => {
  it("leaves out approved siblings that fail consent/privacy checks, and says so", async () => {
    const j = await job("job_bundle_a");
    const key = await putObject(`thorburn/${j.id}/video/r.mp4`, Buffer.from("mp4"));
    const okVideo = await insertAsset({ jobId: j.id, type: "video", status: "approved", title: "Good video", content: patioVideo, fileKey: key });
    const heldVideo = await insertAsset({
      jobId: j.id,
      type: "video",
      status: "approved",
      title: "Video without consent",
      content: patioVideo,
      fileKey: key,
      checks: [{ id: "consent-quote", ok: false, message: "quote not consented" }],
    });
    const heldAds = await insertAsset({ jobId: j.id, type: "ad_copy", status: "approved", title: "Ads with address", content: patioAds, checks: privacyFail });

    await publishAsset(okVideo);
    const manifest = (await readManifest((await (await getDb()).select().from(schema.assets).where(eq(schema.assets.id, okVideo)))[0].externalId!))!;
    expect(manifest.assetIds).toEqual([okVideo]);
    expect(manifest.files.map((f) => f.name).join()).not.toContain(heldVideo.toLowerCase());
    expect(manifest.files.some((f) => f.name.endsWith(".csv"))).toBe(false); // the only ad copy is held
    expect(manifest.warnings.join("\n")).toContain("Ads with address left out: held by failing checks (privacy: Street address in copy)");
    expect(manifest.warnings.join("\n")).toContain("Video without consent left out");
    expect(heldAds).toBeTruthy();
  });
});

describe("ad final URLs (B7)", () => {
  const saved = { ...env.wordpress };
  afterEach(() => Object.assign(env.wordpress, saved));

  it("uses the published project page, as an absolute URL, with utm_content=asset_<id>", async () => {
    const j = await job("job_land_a");
    const pageId = await insertAsset({ jobId: j.id, type: "portfolio_page", status: "approved", title: "Page", content: patioPage });
    await publishAsset(pageId); // local mode → /preview/<id>
    const tenant = await getTenant(TENANT_ID);
    expect(await landingUrl(j, tenant)).toEqual({ url: `${env.appUrl}/preview/${pageId}`, warning: null });

    const adId = await insertAsset({ jobId: j.id, type: "ad_copy", status: "approved", title: "Ads", content: patioAds });
    await publishAsset(adId);
    const [a] = await (await getDb()).select().from(schema.assets).where(eq(schema.assets.id, adId));
    const google = (await getObject(`${a.externalId}/google-pmax.csv`)).toString("utf8");
    expect(google).toContain(`${env.appUrl}/preview/${pageId}?utm_source=google`);
    expect(google).toContain(`utm_content=asset_${adId}`);
    const meta = (await getObject(`${a.externalId}/meta-ads.csv`)).toString("utf8");
    expect(meta).toContain(`${env.appUrl}/preview/${pageId}`);
    expect(meta).not.toContain("co.uk/projects/,");
  });

  it("prefers the WordPress permalink of a published page", async () => {
    const j = await job("job_land_b");
    const pageId = await insertAsset({ jobId: j.id, type: "portfolio_page", status: "published", title: "Page", content: patioPage });
    await (await getDb())
      .update(schema.assets)
      .set({ externalUrl: "https://www.thorburnlandscapes.co.uk/projects/real-permalink/" })
      .where(eq(schema.assets.id, pageId));
    expect((await landingUrl(j, await getTenant(TENANT_ID))).url).toBe("https://www.thorburnlandscapes.co.uk/projects/real-permalink/");
  });

  it("before the page is published: its expected WordPress permalink, or its preview in local mode (warned)", async () => {
    const j = await job("job_land_c");
    const pageId = await insertAsset({ jobId: j.id, type: "portfolio_page", status: "in_review", title: "Page", content: patioPage });
    const tenant = await getTenant(TENANT_ID);
    const local = await landingUrl(j, tenant);
    expect(local.url).toBe(`${env.appUrl}/preview/${pageId}`);
    expect(local.warning).toMatch(/not published yet/);

    Object.assign(env.wordpress, { baseUrl: "https://wp.test", user: "gp", appPassword: "x" });
    const wp = await landingUrl(j, tenant);
    expect(wp.url).toBe(`https://www.thorburnlandscapes.co.uk/projects/${patioPage.slug}/`);
    expect(wp.warning).toMatch(/not published yet/);
  });

  it("falls back to the enquiry page when the job has no portfolio page", async () => {
    const j = await job("job_land_d");
    const r = await landingUrl(j, await getTenant(TENANT_ID));
    expect(r.url).toBe("https://www.thorburnlandscapes.co.uk/contact/");
    expect(r.warning).toMatch(/No portfolio page/);
  });
});
