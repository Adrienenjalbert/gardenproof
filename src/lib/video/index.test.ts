import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { VideoAssetContentSchema } from "@/lib/domain";
import { objectExists, putObject } from "@/lib/storage";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { recheckVideoAsset, renderVideoAsset, renderVideosForJob, type Renderer } from "./index";

/** Every output switched on: these tests cover the full set (lean defaults: src/lib/outputs.test.ts). */
const ALL_OUTPUTS = { ads: true, social: true, areaArticles: true, allVideoFormats: true };

/** Fake renderer: records calls and writes placeholder files (no Chromium in unit tests). */
const calls: { template: string; ratio: string; hook: string }[] = [];
const fakeRenderer: Renderer = async ({ template, props, mp4Path, thumbPath }) => {
  calls.push({ template, ratio: props.ratio, hook: props.hook });
  await fs.writeFile(mp4Path, "mp4");
  if (thumbPath) await fs.writeFile(thumbPath, "jpg");
  return { durationSec: 8, renderMs: 1, bytes: 3 };
};

const T = "ten_vid";

beforeAll(async () => {
  const db = await getDb();
  await db.insert(schema.tenants).values({ id: T, slug: "vidtest", name: "Video Test", config: THORBURN_CONFIG, settings: { outputs: ALL_OUTPUTS } as never });
  await db.insert(schema.customers).values({ id: "cus_v", tenantId: T, firstName: "Harriet", postcode: "SW19 5AB" });
  for (const id of ["job_v", "job_noconsent"]) {
    await db.insert(schema.jobs).values({
      id,
      tenantId: T,
      code: id,
      customerId: "cus_v",
      title: "Pond & gravel garden, Wimbledon",
      area: "Wimbledon",
      postcode: "SW19 5AB",
      service: "full_design",
      startedAt: new Date("2026-08-01"),
      completedAt: new Date("2026-08-22"),
    });
    const put = async (file: string, key: string) => putObject(key, await fs.readFile(path.join(process.cwd(), "public", "demo", file)));
    const b = await put("pond-garden-before.jpg", `vidtest/${id}/b.public.jpg`);
    const a = await put("sandstone-patio-after.jpg", `vidtest/${id}/a.public.jpg`);
    await db.insert(schema.media).values([
      { id: `${id}_b`, tenantId: T, jobId: id, stage: "before", kind: "image", storageKey: `vidtest/${id}/b.jpg`, publicKey: b },
      { id: `${id}_a`, tenantId: T, jobId: id, stage: "after", kind: "image", storageKey: `vidtest/${id}/a.jpg`, publicKey: a },
    ]);
  }
  await db.insert(schema.testimonials).values([
    { id: "tst_v", tenantId: T, jobId: "job_v", token: "tok_v", status: "responded", rating: 5, quote: "Lovely work.", consentPhotos: true, consentArea: true, consentFirstName: true, consentQuote: true },
    { id: "tst_n", tenantId: T, jobId: "job_noconsent", token: "tok_n", status: "responded", rating: 5, quote: "Great.", consentPhotos: false, consentArea: true, consentFirstName: true, consentQuote: true },
  ]);
  await db.insert(schema.assets).values({
    id: "ast_adcopy",
    tenantId: T,
    jobId: "job_v",
    type: "ad_copy",
    title: "Ad copy",
    content: {
      meta: { hooks: ["Pond, gravel, calm", "Tidy crew, calm garden", "Three weeks of craft"], primaryTexts: ["a", "b", "c"], headlines: ["a", "b", "c"] },
      pmax: { headlines: ["a", "b", "c"], longHeadlines: ["a"], descriptions: ["a", "b"] },
      angle: "transformation",
    },
  });
}, 120_000); // PGlite boot + migrations can be slow on a busy machine

const videoRows = async (jobId: string) => {
  const db = await getDb();
  return (await db.select().from(schema.assets).where(eq(schema.assets.jobId, jobId))).filter((a) => a.type === "video");
};

describe("renderVideosForJob", () => {
  it("creates in-review video assets with validated content, files and ad-copy hooks", async () => {
    const res = await renderVideosForJob("job_v", { renderer: fakeRenderer });
    expect(res.skipped).toBeNull();
    expect(res.assetIds).toHaveLength(5);
    const rows = await videoRows("job_v");
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.status).toBe("in_review");
      const c = VideoAssetContentSchema.parse(r.content);
      expect(r.fileKey).toBe(`vidtest/job_v/video/${c.template}-${c.ratio.replace(":", "x")}.mp4`);
      expect(await objectExists(r.fileKey!)).toBe(true);
      expect(await objectExists(r.thumbnailKey!)).toBe(true);
    }
    const reveal = rows.find((r) => r.title === "Reveal · 9:16 · Pond & gravel garden, Wimbledon")!;
    expect(VideoAssetContentSchema.parse(reveal.content).hook).toBe("Pond, gravel, calm");
    // The ad copy is still in review, so the hook is not "ok" yet (QA B8); nor is the Which? rating.
    expect(reveal.checks.find((c) => c.id === "hook-source")).toMatchObject({ ok: false, message: expect.stringMatching(/still in review/) });
    expect(reveal.checks.find((c) => c.id === "which-rating")).toMatchObject({ ok: false, message: "Confirm the Which? rating (4.9) is current before publishing" });
    // Every photo was privacy-screened before planning.
    const db = await getDb();
    const media = await db.select().from(schema.media).where(eq(schema.media.jobId, "job_v"));
    expect(media.every((m) => m.qualityScore != null)).toBe(true);
  });

  it("marks the hook ok once it comes from approved ad copy", async () => {
    const db = await getDb();
    await db.update(schema.assets).set({ status: "approved" }).where(eq(schema.assets.id, "ast_adcopy"));
    await renderVideosForJob("job_v", { renderer: fakeRenderer, formats: { reveal: ["1:1"], proof: [] } });
    const reveal = (await videoRows("job_v")).find((r) => r.title.startsWith("Reveal · 1:1"))!;
    expect(reveal.checks.find((c) => c.id === "hook-source")).toMatchObject({ ok: true, message: "Hook from approved ad copy" });
  });

  it("is idempotent: re-running updates the same rows", async () => {
    const before = (await videoRows("job_v")).map((r) => r.id).sort();
    await renderVideosForJob("job_v", { renderer: fakeRenderer });
    expect((await videoRows("job_v")).map((r) => r.id).sort()).toEqual(before);
  });

  it("never overwrites an approved video: creates version 2 with its own file", async () => {
    const db = await getDb();
    const reveal = (await videoRows("job_v")).find((r) => r.title.startsWith("Reveal · 9:16"))!;
    await db.update(schema.assets).set({ status: "approved" }).where(eq(schema.assets.id, reveal.id));
    await renderVideosForJob("job_v", { renderer: fakeRenderer, formats: { reveal: ["9:16"], proof: [] } });
    const rows = (await videoRows("job_v")).filter((r) => r.title.startsWith("Reveal · 9:16"));
    expect(rows).toHaveLength(2);
    const v1 = rows.find((r) => r.id === reveal.id)!;
    const v2 = rows.find((r) => r.id !== reveal.id)!;
    expect(v1.status).toBe("approved");
    expect(v1.fileKey).toBe("vidtest/job_v/video/reveal-9x16.mp4");
    expect(v2.version).toBe(2);
    expect(v2.fileKey).toBe("vidtest/job_v/video/reveal-9x16-v2.mp4");
  });

  it("renders nothing when photo consent was declined", async () => {
    const res = await renderVideosForJob("job_noconsent", { renderer: fakeRenderer });
    expect(res.skipped).toMatch(/declined/);
    expect(await videoRows("job_noconsent")).toHaveLength(0);
  });
});

describe("renderVideoAsset", () => {
  it("re-renders a draft in place using the edited hook", async () => {
    const db = await getDb();
    const proof = (await videoRows("job_v")).find((r) => r.title.startsWith("Proof · 1:1"))!;
    const content = VideoAssetContentSchema.parse(proof.content);
    await db.update(schema.assets).set({ content: { ...content, hook: "Edited hook" } }).where(eq(schema.assets.id, proof.id));
    calls.length = 0;
    const id = await renderVideoAsset(proof.id, { renderer: fakeRenderer });
    expect(id).toBe(proof.id);
    expect(calls).toEqual([{ template: "proof", ratio: "1:1", hook: "Edited hook" }]);
    const [row] = await db.select().from(schema.assets).where(eq(schema.assets.id, id));
    expect((row!.content as { props: { hook: string } }).props.hook).toBe("Edited hook");
  });

  it("refuses to burn an edited hook that fails the privacy lint, and flags it on recheck", async () => {
    const db = await getDb();
    const proof = (await videoRows("job_v")).find((r) => r.title.startsWith("Proof · 1:1"))!;
    const content = VideoAssetContentSchema.parse(proof.content);
    await db.update(schema.assets).set({ content: { ...content, hook: "Finished at 14 Ridgway Place" } }).where(eq(schema.assets.id, proof.id));
    const checks = await recheckVideoAsset(proof.id);
    expect(checks.find((c) => c.id === "privacy" && !c.ok)?.message).toMatch(/address/);
    expect(checks.find((c) => c.id === "hook-edit")?.ok).toBe(false);
    calls.length = 0;
    await expect(renderVideoAsset(proof.id, { renderer: fakeRenderer })).rejects.toThrow(/hook can't be used/);
    expect(calls).toEqual([]);
    await db.update(schema.assets).set({ content }).where(eq(schema.assets.id, proof.id));
    const clean = await recheckVideoAsset(proof.id);
    expect(clean.filter((c) => c.id === "privacy").every((c) => c.ok)).toBe(true);
  });

  it("creates a new version when re-rendering an approved asset", async () => {
    const approved = (await videoRows("job_v")).find((r) => r.status === "approved")!;
    const id = await renderVideoAsset(approved.id, { renderer: fakeRenderer });
    expect(id).not.toBe(approved.id);
  });
});

describe("consent changes after rendering", () => {
  it("re-render is refused once the homeowner withdraws consent", async () => {
    const db = await getDb();
    const [any] = await videoRows("job_v");
    await db.update(schema.testimonials).set({ withdrawnAt: new Date() }).where(eq(schema.testimonials.id, "tst_v"));
    await expect(renderVideoAsset(any!.id, { renderer: fakeRenderer })).rejects.toThrow(/withdrew consent/);
    expect((await renderVideosForJob("job_v", { renderer: fakeRenderer })).skipped).toMatch(/withdrew consent/);
    await db.update(schema.testimonials).set({ withdrawnAt: null }).where(eq(schema.testimonials.id, "tst_v"));
  });

  it("a flagged photo is never used until blurred or cleared", async () => {
    const db = await getDb();
    await db.update(schema.media).set({ qualityNotes: "needs blur: house number visible" }).where(eq(schema.media.id, "job_v_a"));
    expect((await renderVideosForJob("job_v", { renderer: fakeRenderer })).skipped).toMatch(/No publishable after photo/);
    await db.update(schema.media).set({ privacyClearedAt: new Date() }).where(eq(schema.media.id, "job_v_a"));
    expect((await renderVideosForJob("job_v", { renderer: fakeRenderer, formats: { reveal: ["9:16"], proof: [] } })).skipped).toBeNull();
  });
});
