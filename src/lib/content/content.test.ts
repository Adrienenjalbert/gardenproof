/**
 * Integration tests for the content engine on in-memory PGlite, mock AI.
 * Covers: enrichment writes, consent gating, idempotent versioning, approved-asset protection,
 * SEO clusters (no thin pages), regeneration with a reviewer note.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { ASSET_CONTENT_SCHEMAS, type PortfolioPageContent, type SeoArticleContent } from "@/lib/domain";
import { putObject } from "@/lib/storage";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { enrichJob, generateContentForJob, recheckAsset, refreshSeoForPortfolioPage, regenerateAsset } from "./index";
import { IMAGE_BATCH, UNSCREENED_NOTE } from "./enrich";

/** Every output switched on: these tests cover the full set (lean defaults: src/lib/outputs.test.ts). */
const ALL_OUTPUTS = { ads: true, social: true, areaArticles: true, allVideoFormats: true };

const T = "ten_modb";

async function image(file: string, key: string) {
  return putObject(`modb-test/${key}`, await fs.readFile(path.join(process.cwd(), "public", "demo", file)));
}

type JobSeed = {
  id: string;
  service: string;
  postcode: string;
  area: string;
  brief: string;
  testimonial?: Partial<typeof schema.testimonials.$inferInsert> | null;
};

async function seedJob(j: JobSeed) {
  const db = await getDb();
  const cus = `cus_${j.id}`;
  await db.insert(schema.customers).values({ id: cus, tenantId: T, firstName: "James", lastName: "Patel", postcode: j.postcode, area: j.area });
  await db.insert(schema.jobs).values({
    id: j.id, tenantId: T, code: `TL-${j.id.slice(-4)}`, customerId: cus, status: "ready_for_content",
    service: j.service, postcode: j.postcode, area: j.area, brief: j.brief, completedAt: new Date("2026-09-01"),
  });
  const before = await image("pond-garden-before.jpg", `${j.id}/before.jpg`);
  const after = await image("sandstone-patio-after.jpg", `${j.id}/after.jpg`);
  await db.insert(schema.media).values([
    { id: `${j.id}_b`, tenantId: T, jobId: j.id, stage: "before", kind: "image", storageKey: before, publicKey: before },
    { id: `${j.id}_a`, tenantId: T, jobId: j.id, stage: "after", kind: "image", storageKey: after, publicKey: after },
  ]);
  if (j.testimonial !== null) {
    await db.insert(schema.testimonials).values({
      id: `tst_${j.id}`, tenantId: T, jobId: j.id, customerId: cus, token: `tok_${j.id}`, status: "responded", rating: 5,
      quote: "Tidy, on time and exactly what we pictured.", consentPhotos: true, consentArea: true, consentFirstName: true, consentQuote: true,
      ...j.testimonial,
    });
  }
}

const PATIO = "Indian sandstone patio in a circle pattern with a red brick band, two curved brick raised beds planted up, new striped lawn and a timber pergola. Took two and a half weeks.";

async function assetsFor(jobId: string) {
  const db = await getDb();
  return db.select().from(schema.assets).where(eq(schema.assets.jobId, jobId));
}

beforeAll(async () => {
  process.env.AI_PROVIDER = "mock";
  const db = await getDb();
  await db.insert(schema.tenants).values({ id: T, slug: "modb-test", name: "Thorburn Landscapes", config: THORBURN_CONFIG, settings: { outputs: ALL_OUTPUTS } as never });
  await seedJob({ id: "job_p1", service: "patio_paving", postcode: "SW15 2QT", area: "Putney", brief: PATIO });
  await seedJob({ id: "job_p2", service: "patio_paving", postcode: "SW15 6PR", area: "Putney", brief: "Laid a porcelain patio with granite setts edging and built a curved brick retaining wall. About two weeks." });
  await seedJob({ id: "job_noarea", service: "patio_paving", postcode: "SW15 1AA", area: "Putney", brief: PATIO, testimonial: { consentArea: false } });
  await seedJob({ id: "job_refused", service: "patio_paving", postcode: "SW15 3BB", area: "Putney", brief: PATIO, testimonial: { consentPhotos: false } });
  await seedJob({ id: "job_withdrawn", service: "patio_paving", postcode: "SW15 4CC", area: "Putney", brief: PATIO, testimonial: { withdrawnAt: new Date("2026-09-10") } });
  await seedJob({ id: "job_noquote", service: "patio_paving", postcode: "SW15 5DD", area: "Putney", brief: PATIO, testimonial: { consentQuote: false } });
  await seedJob({ id: "job_thin", service: "full_design", postcode: "SW19 7NB", area: "Wimbledon", brief: "" });
}, 120_000); // PGlite boot + migrations

describe("enrichJob", () => {
  it("writes enrichment, quality scores and hero flags for the job's own media", async () => {
    const e = await enrichJob("job_p1");
    expect(e.service).toBe("patio_paving");
    expect(e.materials).toEqual(["Indian sandstone", "red brick", "timber"]);
    expect(e.heroBeforeMediaId).toBe("job_p1_b");
    expect(e.heroAfterMediaId).toBe("job_p1_a");
    const db = await getDb();
    const media = await db.select().from(schema.media).where(eq(schema.media.jobId, "job_p1"));
    expect(media.every((m) => m.isHero && m.qualityScore! > 0.5)).toBe(true);
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, "job_p1"));
    expect(job.enrichment?.features).toContain("curved brick raised beds");
  });
});

describe("generateContentForJob", () => {
  it("creates the four job assets in review, valid and lint-clean, and no video rows", async () => {
    const summary = await generateContentForJob("job_p1");
    expect(summary.skipped).toBeNull();
    expect(summary.assets.map((a) => a.type)).toEqual(["portfolio_page", "ad_copy", "social_pack", "gbp_post"]);
    const rows = await assetsFor("job_p1");
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.status).toBe("in_review");
      expect(ASSET_CONTENT_SCHEMAS[r.type].safeParse(r.content).success).toBe(true);
      expect(r.checks.find((c) => c.id === "demo-ai")).toEqual({ id: "demo-ai", ok: true, message: "Generated by demo mode (no API key)" });
      expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    }
    const page = rows.find((r) => r.type === "portfolio_page")!.content as unknown as PortfolioPageContent;
    expect(page.testimonial).toEqual({ quote: "Tidy, on time and exactly what we pictured.", rating: 5, attribution: "James, Putney" });
    expect(page.gallery.map((g) => g.mediaId).sort()).toEqual(["job_p1_a", "job_p1_b"]);
    expect(JSON.stringify(page)).not.toContain("Patel");
    const db = await getDb();
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, "job_p1"));
    expect(job.status).toBe("in_review");
  });

  it("does not create an area article from a single project (no thin pages)", async () => {
    const db = await getDb();
    expect(await db.select().from(schema.assets).where(eq(schema.assets.type, "seo_article"))).toHaveLength(0);
  });

  it("is idempotent: a re-run bumps versions in place instead of duplicating", async () => {
    const before = await assetsFor("job_p1");
    await generateContentForJob("job_p1");
    const after = await assetsFor("job_p1");
    expect(after.map((a) => a.id).sort()).toEqual(before.map((a) => a.id).sort());
    expect(after.every((a) => a.version === 2)).toBe(true);
  });

  it("never overwrites an approved asset: it adds a new in-review version", async () => {
    const db = await getDb();
    const [ad] = (await assetsFor("job_p1")).filter((a) => a.type === "ad_copy");
    await db.update(schema.assets).set({ status: "approved" }).where(eq(schema.assets.id, ad.id));
    await generateContentForJob("job_p1", { types: ["ad_copy"] });
    const ads = (await assetsFor("job_p1")).filter((a) => a.type === "ad_copy").sort((a, b) => a.version - b.version);
    expect(ads.map((a) => [a.id === ad.id, a.version, a.status])).toEqual([
      [true, 2, "approved"],
      [false, 3, "in_review"],
    ]);
    expect(ads[0].content).toEqual(ad.content);
  });

  it("creates nothing when the homeowner refused photo consent, and logs why", async () => {
    const summary = await generateContentForJob("job_refused");
    expect(summary).toEqual({ jobId: "job_refused", skipped: "no_consent", assets: [] });
    expect(await assetsFor("job_refused")).toHaveLength(0);
    const db = await getDb();
    const events = await db.select().from(schema.events).where(and(eq(schema.events.entityId, "job_refused"), eq(schema.events.type, "content.skipped_no_consent")));
    expect(events).toHaveLength(1);
  });

  it("creates nothing once the homeowner withdrew consent, and logs it", async () => {
    const summary = await generateContentForJob("job_withdrawn");
    expect(summary.skipped).toBe("no_consent");
    expect(await assetsFor("job_withdrawn")).toHaveLength(0);
    const db = await getDb();
    const events = await db.select().from(schema.events).where(and(eq(schema.events.entityId, "job_withdrawn"), eq(schema.events.type, "content.skipped_withdrawn")));
    expect(events).toHaveLength(1);
  });

  it("uses photos but no quote or rating when the quote is not consented (P0-3)", async () => {
    await generateContentForJob("job_noquote");
    const rows = await assetsFor("job_noquote");
    expect(rows).toHaveLength(4);
    const page = rows.find((r) => r.type === "portfolio_page")!.content as unknown as PortfolioPageContent;
    expect(page.testimonial).toBeNull();
    expect(page.gallery.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.map((r) => r.content))).not.toMatch(/Tidy, on time|5 out of 5|5\/5/);
  });

  it("thin input: honest short copy and a thin-input check asking for crew notes (QA B3)", async () => {
    await generateContentForJob("job_thin");
    const rows = await assetsFor("job_thin");
    for (const r of rows) {
      expect(r.checks.find((c) => c.id === "thin-input")).toMatchObject({ ok: false, message: expect.stringMatching(/Add crew notes/) });
      expect(r.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(["thin-input"]);
    }
  });

  it("keeps the area out of copy and slug without area consent", async () => {
    await generateContentForJob("job_noarea");
    const rows = await assetsFor("job_noarea");
    const text = JSON.stringify(rows.map((r) => r.content));
    expect(text).not.toMatch(/Putney|SW15/);
    expect(text).toContain("South West London");
    const page = rows.find((r) => r.type === "portfolio_page")!.content as unknown as PortfolioPageContent;
    expect(page.facts.area).toBeNull();
    expect(page.testimonial?.attribution).toBe("James, South West London");
  });

  it("creates one area article only from approved/published pages (P2-3), then refreshes it", async () => {
    await generateContentForJob("job_p2");
    const db = await getDb();
    // Both Putney pages are only in review: no article yet.
    expect(await db.select().from(schema.assets).where(eq(schema.assets.type, "seo_article"))).toHaveLength(0);
    const pages = (await Promise.all(["job_p1", "job_p2"].map(assetsFor))).flat().filter((a) => a.type === "portfolio_page");
    for (const p of pages) await db.update(schema.assets).set({ status: "approved" }).where(eq(schema.assets.id, p.id));
    expect(await refreshSeoForPortfolioPage(pages[0].id)).not.toBeNull();
    const articles = await db.select().from(schema.assets).where(eq(schema.assets.type, "seo_article"));
    expect(articles).toHaveLength(1);
    const a = articles[0].content as unknown as SeoArticleContent;
    expect(a.slug).toBe("patios-and-paving-putney");
    expect(a.relatedJobIds.sort()).toEqual(["job_p1", "job_p2"]); // job_noarea has no area consent
    expect(articles[0].jobId).toBeNull();
    expect(articles[0].checks.filter((c) => !c.ok)).toEqual([]);
    expect(a.bodyMarkdown).toContain("https://www.thorburnlandscapes.co.uk/projects/");

    await generateContentForJob("job_p1", { types: ["portfolio_page"] });
    const again = await db.select().from(schema.assets).where(eq(schema.assets.type, "seo_article"));
    expect(again).toHaveLength(1);
    expect(again[0].version).toBe(2);
  });

  it("never moves a published job back to in review when content is regenerated (P2-2)", async () => {
    const db = await getDb();
    const [page] = (await assetsFor("job_p1")).filter((a) => a.type === "portfolio_page" && a.status === "approved");
    await db.update(schema.assets).set({ status: "published" }).where(eq(schema.assets.id, page.id));
    // The pipeline sets ready_for_content before regenerating.
    await db.update(schema.jobs).set({ status: "ready_for_content" }).where(eq(schema.jobs.id, "job_p1"));
    await generateContentForJob("job_p1", { types: ["gbp_post"] });
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, "job_p1"));
    expect(job.status).toBe("published");
  });

  it("gives each job a unique portfolio slug", async () => {
    const [p1] = (await assetsFor("job_p1")).filter((a) => a.type === "portfolio_page");
    const [n] = (await assetsFor("job_noarea")).filter((a) => a.type === "portfolio_page");
    expect((p1.content as { slug: string }).slug).not.toBe((n.content as { slug: string }).slug);
  });
});

describe("regenerateAsset / recheckAsset", () => {
  it("regenerates one asset with a reviewer note and records it", async () => {
    const [gbp] = (await assetsFor("job_p2")).filter((a) => a.type === "gbp_post");
    const res = await regenerateAsset(gbp.id, "Mention the granite setts first");
    expect(res).toMatchObject({ assetId: gbp.id, version: gbp.version + 1, action: "updated" });
    const [row] = (await assetsFor("job_p2")).filter((a) => a.id === gbp.id);
    expect(row.checks.find((c) => c.id === "instructions")?.message).toMatch(/demo mode/);
  });

  it("regenerating an approved asset creates a new draft version", async () => {
    const db = await getDb();
    const [page] = (await assetsFor("job_p2")).filter((a) => a.type === "portfolio_page");
    await db.update(schema.assets).set({ status: "published" }).where(eq(schema.assets.id, page.id));
    const res = await regenerateAsset(page.id);
    expect(res.action).toBe("new_version");
    expect(res.assetId).not.toBe(page.id);
  });

  it("regenerates an area article from its cluster", async () => {
    const db = await getDb();
    const [article] = await db.select().from(schema.assets).where(eq(schema.assets.type, "seo_article"));
    const res = await regenerateAsset(article.id, "Shorter intro");
    expect(res.assetId).toBe(article.id);
  });

  it("recheck flags a manual edit that breaks the rules", async () => {
    const db = await getDb();
    const [social] = (await assetsFor("job_p2")).filter((a) => a.type === "social_pack");
    const content = { ...(social.content as object), captions: ["Your dream garden awaits!! Call 07700 900123"] };
    await db.update(schema.assets).set({ content }).where(eq(schema.assets.id, social.id));
    const checks = await recheckAsset(social.id);
    expect(checks.find((c) => c.id === "banned-phrases")?.ok).toBe(false);
    expect(checks.find((c) => c.id === "demo-ai")).toBeDefined();
  });

  it("recheck re-lints an area article after a manual edit (P2-3)", async () => {
    const db = await getDb();
    const [article] = await db.select().from(schema.assets).where(eq(schema.assets.type, "seo_article"));
    expect(article.checks.find((c) => c.id === "privacy")?.ok).toBe(true);
    const content = { ...(article.content as object), bodyMarkdown: `${(article.content as SeoArticleContent).bodyMarkdown}\n\nOur latest garden is at 14 Acacia Road, SW15 2QT.` };
    await db.update(schema.assets).set({ content }).where(eq(schema.assets.id, article.id));
    const checks = await recheckAsset(article.id);
    expect(checks.find((c) => c.id === "privacy")?.ok).toBe(false);
    expect(checks.filter((c) => c.id === "privacy")).toHaveLength(1);
  });
});

describe("privacy screening (P1-4)", () => {
  it("screens every image in batches; one it could not assess is withheld, never treated as safe", async () => {
    const db = await getDb();
    await seedJob({ id: "job_many", service: "patio_paving", postcode: "SW15 2QT", area: "Putney", brief: PATIO });
    const extra = await image("sandstone-patio-after.jpg", "job_many/extra.jpg");
    const rows = Array.from({ length: IMAGE_BATCH + 3 }, (_, i) => ({
      id: `job_many_x${String(i).padStart(2, "0")}`, tenantId: T, jobId: "job_many", stage: "after" as const, kind: "image" as const,
      storageKey: extra, publicKey: extra, createdAt: new Date(Date.now() + 1000 * (i + 1)),
    }));
    // The last after-photo has no file: the model never sees it.
    rows.push({ ...rows[0], id: "job_many_missing", storageKey: "modb-test/job_many/missing.jpg", publicKey: "modb-test/job_many/missing.jpg", createdAt: new Date(Date.now() + 60_000) });
    await db.insert(schema.media).values(rows);
    await enrichJob("job_many");
    const media = await db.select().from(schema.media).where(eq(schema.media.jobId, "job_many"));
    expect(media).toHaveLength(IMAGE_BATCH + 6);
    expect(media.every((m) => m.qualityScore != null)).toBe(true);
    const missing = media.find((m) => m.id === "job_many_missing")!;
    expect(missing.qualityNotes).toContain(UNSCREENED_NOTE);
    const late = media.find((m) => m.id === `job_many_x${IMAGE_BATCH + 2}`)!;
    expect(late.qualityNotes ?? "").not.toContain("needs blur");
    await generateContentForJob("job_many");
    const page = (await assetsFor("job_many")).find((a) => a.type === "portfolio_page")!.content as unknown as PortfolioPageContent;
    const ids = page.gallery.map((g) => g.mediaId);
    expect(ids).toContain(late.id);
    expect(ids).not.toContain("job_many_missing");
  });
});
