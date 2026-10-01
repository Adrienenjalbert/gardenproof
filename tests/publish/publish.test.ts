import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { env } from "@/lib/config";
import { blockingChecks, publishAsset, PublishError, withPublishError } from "@/lib/publish";
import { listProjectCards, loadPreview, mediaForJobs } from "@/lib/publish/data";
import { readManifest } from "@/lib/publish/exports";
import { getObject, putObject } from "@/lib/storage";
import { getTenant } from "@/lib/tenants";
import { GET as exportGet } from "@/app/api/export/[assetId]/route";
import { GET as feedGet } from "@/app/api/export/portfolio.json/route";
import { insertAsset, seedBase, TENANT_ID } from "../fixtures/mod-d-db";
import { patioAds, patioArticle, patioGbp, patioPage, patioSocial, patioVideo, pondPage } from "../fixtures/mod-d";

beforeAll(seedBase, 120_000);

async function row(id: string) {
  const db = await getDb();
  const [a] = await db.select().from(schema.assets).where(eq(schema.assets.id, id));
  return a;
}
async function eventsFor(id: string, type: string) {
  const db = await getDb();
  return db.select().from(schema.events).where(and(eq(schema.events.entityId, id), eq(schema.events.type, type)));
}
const ctx = (assetId: string) => ({ params: Promise.resolve({ assetId }) }) as RouteContext<"/api/export/[assetId]">;

describe("withPublishError", () => {
  it("keeps operator notes and replaces the previous failure line", () => {
    const once = withPublishError("Check the hero crop", "WordPress 500");
    expect(once).toBe("Check the hero crop\nPublish failed: WordPress 500");
    expect(withPublishError(once, "timeout")).toBe("Check the hero crop\nPublish failed: timeout");
    expect(withPublishError(once, null)).toBe("Check the hero crop");
    expect(withPublishError("Publish failed: x", null)).toBeNull();
  });
});

describe("public-safety rules", () => {
  it("blocks on failing consent/privacy checks only", () => {
    expect(blockingChecks([{ id: "consent-photos", ok: false, message: "no consent yet" }])).toEqual(["consent-photos: no consent yet"]);
    expect(blockingChecks([{ id: "consent-photos", ok: true, message: "" }, { id: "banned-phrases", ok: false, message: "x" }])).toEqual([]);
  });
  it("blocks on any failing consent* check too (quote, name, area)", () => {
    expect(blockingChecks([{ id: "consent-quote", ok: false, message: "no" }, { id: "privacy", ok: false, message: "address" }])).toEqual([
      "consent-quote: no",
      "privacy: address",
    ]);
  });
  it("hides photos flagged 'needs blur' until blurred or cleared, even though an EXIF-stripped copy exists", async () => {
    const db = await getDb();
    const base = { tenantId: TENANT_ID, jobId: "job_pond", stage: "after" as const, kind: "image" as const };
    await db.insert(schema.media).values([
      { ...base, id: "med_blur_pending", storageKey: "o/1.jpg", publicKey: "o/1.public.jpg", qualityNotes: "Face at window — needs blur" },
      { ...base, id: "med_blur_done", storageKey: "o/2.jpg", publicKey: "o/2.public.jpg", blurredKey: "o/2.blurred.jpg", qualityNotes: "needs blur" },
      { ...base, id: "med_blur_cleared", storageKey: "o/3.jpg", publicKey: "o/3.public.jpg", privacyClearedAt: new Date(), qualityNotes: "needs blur" },
      { ...base, id: "med_voice", kind: "audio" as const, stage: "progress" as const, storageKey: "o/4.ogg", publicKey: "o/4.ogg" },
    ]);
    const keys = Object.fromEntries((await mediaForJobs(["job_pond"])).map((m) => [m.id, m.publicKey]));
    expect(keys).toMatchObject({
      med_blur_pending: null,
      med_blur_done: "o/2.blurred.jpg",
      med_blur_cleared: "o/3.public.jpg",
      med_voice: null,
      med_pond_a1: "thorburn/job_pond/after-1.jpg",
    });
    await db.delete(schema.media).where(inArray(schema.media.id, ["med_blur_pending", "med_blur_done", "med_blur_cleared", "med_voice"]));
  });
  it("holds an approved asset whose photos lack consent", async () => {
    const id = await insertAsset({
      jobId: "job_pond",
      type: "portfolio_page",
      status: "approved",
      title: "Pond no consent",
      content: pondPage,
      checks: [{ id: "consent-photos", ok: false, message: "Homeowner has not consented to photos" }],
    });
    await expect(publishAsset(id)).rejects.toThrow(/held by failing checks/);
    const a = await row(id);
    expect(a.status).toBe("approved");
    expect(a.reviewNotes).toContain("consent-photos");
  });
});

describe("publishAsset — local mode (no WordPress credentials)", () => {
  it("publishes an approved portfolio page to the local preview and marks the job published", async () => {
    const id = await insertAsset({ jobId: "job_patio", type: "portfolio_page", status: "approved", title: "Patio page", content: patioPage });
    const result = await publishAsset(id);
    expect(result).toMatchObject({ mode: "local", externalUrl: `/preview/${id}`, status: "published" });
    const a = await row(id);
    expect(a.status).toBe("published");
    expect(a.publishedAt).toBeInstanceOf(Date);
    const db = await getDb();
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, "job_patio"));
    expect(job.status).toBe("published");
    expect(await eventsFor(id, "asset.published")).toHaveLength(1);

    // idempotent: publishing again keeps the first publishedAt
    await publishAsset(id);
    expect((await row(id)).publishedAt?.getTime()).toBe(a.publishedAt?.getTime());
  });

  it("refuses assets that are not approved, without side effects", async () => {
    const id = await insertAsset({ jobId: "job_pond", type: "portfolio_page", status: "in_review", title: "Pond", content: pondPage });
    await expect(publishAsset(id)).rejects.toThrow(/Only approved assets/);
    expect((await row(id)).status).toBe("in_review");
    await expect(publishAsset("ast_missing")).rejects.toBeInstanceOf(PublishError);
  });

  it("keeps an invalid asset approved, notes the error and logs publish_failed", async () => {
    const id = await insertAsset({ jobId: "job_patio", type: "portfolio_page", status: "approved", title: "Broken", content: { slug: "x" } });
    await expect(publishAsset(id)).rejects.toThrow(/Publishing "Broken" failed: content is invalid/);
    const a = await row(id);
    expect(a.status).toBe("approved");
    expect(a.reviewNotes).toMatch(/^Publish failed: content is invalid/);
    expect(await eventsFor(id, "asset.publish_failed")).toHaveLength(1);
  });

  it("publishes articles to the preview", async () => {
    const id = await insertAsset({ jobId: null, type: "seo_article", status: "approved", title: "Article", content: patioArticle });
    expect((await publishAsset(id)).externalUrl).toBe(`/preview/${id}`);
    const preview = await loadPreview(id);
    expect(preview?.view.kind).toBe("seo_article");
  });
});

describe("publishAsset — ad bundle, social and GBP exports", () => {
  it("writes Google + Meta CSVs and the rendered mp4s, served by /api/export", async () => {
    const videoKey = await putObject("thorburn/job_patio/videos/reveal-9x16.mp4", Buffer.from("fake-mp4"));
    const videoId = await insertAsset({ jobId: "job_patio", type: "video", status: "approved", title: "Reveal 9:16", content: patioVideo, fileKey: videoKey });
    await insertAsset({ jobId: "job_patio", type: "video", status: "in_review", title: "Not approved", content: patioVideo, fileKey: videoKey });
    const adId = await insertAsset({ jobId: "job_patio", type: "ad_copy", status: "approved", title: "Ads", content: patioAds });

    const result = await publishAsset(adId);
    expect(result.mode).toBe("export");
    expect(result.externalUrl).toBe(`/api/export/${adId}`);
    const a = await row(adId);
    expect(a.externalId).toMatch(/^exports\/job_patio\/\d{4}-\d{2}-\d{2}\/ads$/);

    const manifest = (await readManifest(a.externalId!))!;
    const names = manifest.files.map((f) => f.name);
    expect(names).toEqual(["google-pmax.csv", "meta-ads.csv", `reveal-9x16-${videoId}.mp4`.toLowerCase()]);
    const meta = (await getObject(`${a.externalId}/meta-ads.csv`)).toString("utf8");
    expect(meta).toContain(`utm_content=asset_${videoId}`);
    expect(meta.split("\r\n").filter(Boolean)).toHaveLength(1 + 3); // one approved video × 3 variants

    const index = await exportGet(new Request(`http://t/api/export/${adId}`), ctx(adId));
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toContain("google-pmax.csv");
    const csv = await exportGet(new Request(`http://t/api/export/${adId}?file=google-pmax.csv`), ctx(adId));
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="google-pmax.csv"');
    expect(await csv.text()).toContain("Sandstone Patios Putney");
    const sneaky = await exportGet(new Request(`http://t/api/export/${adId}?file=../../../etc/passwd`), ctx(adId));
    expect(sneaky.status).toBe(404);

    // the approved video can be published too and points at the same refreshed bundle
    expect((await publishAsset(videoId)).externalUrl).toBe(`/api/export/${videoId}`);
  });

  it("exports social pack and GBP post text files", async () => {
    const socialId = await insertAsset({ jobId: "job_patio", type: "social_pack", status: "approved", title: "Social", content: patioSocial });
    const gbpId = await insertAsset({ jobId: "job_patio", type: "gbp_post", status: "approved", title: "GBP", content: patioGbp });
    await publishAsset(socialId);
    await publishAsset(gbpId);
    const social = (await getObject(`${(await row(socialId)).externalId}/social-pack.txt`)).toString("utf8");
    expect(social).toContain("/api/media/thorburn/job_patio/after-1.jpg");
    const gbp = (await getObject(`${(await row(gbpId)).externalId}/gbp-post.txt`)).toString("utf8");
    expect(gbp).toContain("Phase 2");
  });

  it("does not serve exports for unpublished assets", async () => {
    const id = await insertAsset({ jobId: "job_patio", type: "gbp_post", status: "approved", title: "GBP", content: patioGbp });
    expect((await exportGet(new Request(`http://t/api/export/${id}`), ctx(id))).status).toBe(404);
  });
});

describe("publishAsset — WordPress mode", () => {
  const saved = { ...env.wordpress };
  afterEach(() => {
    Object.assign(env.wordpress, saved);
    vi.unstubAllGlobals();
  });

  function fakeWordPress(opts: { failPosts?: boolean } = {}) {
    const calls: { method: string; url: string; body?: unknown; auth: string | null }[] = [];
    const uploaded = new Map<string, number>();
    let nextId = 100;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ? "<binary>" : undefined;
      calls.push({ method, url: url.pathname + url.search, body, auth: headers.get("authorization") });
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
      const path = url.pathname.replace("/wp-json/wp/v2", "");
      if (path === "/media" && method === "GET") {
        const id = uploaded.get(url.searchParams.get("slug")!);
        return json(id ? [{ id, source_url: `https://wp.test/uploads/${id}.jpg` }] : []);
      }
      if (path === "/media" && method === "POST") {
        const slug = /filename="([^".]+)/.exec(headers.get("content-disposition")!)![1];
        const id = ++nextId;
        uploaded.set(slug, id);
        return json({ id, source_url: `https://wp.test/uploads/${id}.jpg` }, 201);
      }
      if (path.startsWith("/media/")) return json({ id: Number(path.split("/")[2]) });
      if (opts.failPosts && path.startsWith("/gp_project")) return json({ code: "rest_cannot_create", message: "Sorry, you are not allowed" }, 403);
      if (path === "/gp_project" && method === "GET") return json([]);
      if (path === "/gp_project" && method === "POST") return json({ id: 555, slug: body && (body as { slug: string }).slug, link: "https://wp.test/projects/indian-sandstone-circle-patio-putney/" }, 201);
      if (path === "/gp_project/555") return json({ id: 555, link: "https://wp.test/projects/indian-sandstone-circle-patio-putney/" });
      return json({ code: "rest_no_route", message: "No route" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    Object.assign(env.wordpress, { baseUrl: "https://wp.test", user: "gardenproof", appPassword: "abcd efgh ijkl" });
    return calls;
  }

  it("uploads images once, creates then updates the gp_project post with structured meta", async () => {
    const calls = fakeWordPress();
    const id = await insertAsset({ jobId: "job_patio", type: "portfolio_page", status: "approved", title: "Patio WP", content: patioPage });
    const result = await publishAsset(id);
    expect(result).toMatchObject({ mode: "wordpress", externalId: "555", externalUrl: "https://wp.test/projects/indian-sandstone-circle-patio-putney/" });
    expect(calls.every((c) => c.auth === `Basic ${Buffer.from("gardenproof:abcd efgh ijkl").toString("base64")}`)).toBe(true);
    expect(calls.filter((c) => c.method === "POST" && c.url === "/wp-json/wp/v2/media")).toHaveLength(1);
    const alt = calls.find((c) => c.url === "/wp-json/wp/v2/media/101")!;
    expect(alt.body).toMatchObject({ alt_text: patioPage.gallery[0].alt });

    // created, then re-saved so JSON-LD uses the real permalink
    const posts = calls.filter((c) => c.method === "POST" && c.url.startsWith("/wp-json/wp/v2/gp_project"));
    expect(posts.map((c) => c.url)).toEqual(["/wp-json/wp/v2/gp_project", "/wp-json/wp/v2/gp_project/555"]);
    const payload = posts[1].body as { featured_media: number; meta: { gp_content: string } };
    expect(payload.featured_media).toBe(101);
    const meta = JSON.parse(payload.meta.gp_content);
    expect(meta.view.hero).toMatchObject({ wpId: 101, src: "https://wp.test/uploads/101.jpg" });
    expect(meta.view.canonicalUrl).toBe("https://wp.test/projects/indian-sandstone-circle-patio-putney/");
    // P0-1: the REST-readable meta carries URLs only, never storage keys
    expect(payload.meta.gp_content).not.toMatch(/"key"\s*:/);
    expect(payload.meta.gp_content).not.toContain("thorburn/job_patio/");
    // P1-8/P0-3: no testimonial row with consentQuote → no quote or Review in the payload
    expect(meta.view.testimonial).toBeNull();

    // republish: no new upload, straight update of post 555
    calls.length = 0;
    await publishAsset(id);
    expect(calls.filter((c) => c.method === "POST" && c.url === "/wp-json/wp/v2/media")).toHaveLength(0);
    expect(calls.filter((c) => c.method === "POST" && c.url.startsWith("/wp-json/wp/v2/gp_project")).map((c) => c.url)).toEqual([
      "/wp-json/wp/v2/gp_project/555",
    ]);
  });

  it("keeps the asset approved and never leaks credentials when WordPress refuses", async () => {
    fakeWordPress({ failPosts: true });
    const id = await insertAsset({ jobId: "job_patio", type: "portfolio_page", status: "approved", title: "Patio WP fail", content: patioPage });
    const err = await publishAsset(id).catch((e: Error) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as Error).message).toContain("WordPress 403");
    expect((err as Error).message).not.toContain("abcd");
    const a = await row(id);
    expect(a.status).toBe("approved");
    expect(a.reviewNotes).toContain("Sorry, you are not allowed");
  });
});

describe("portfolio listing and feed", () => {
  it("lists only published pages publicly, drafts on request, and exposes a JSON feed", async () => {
    await insertAsset({ jobId: "job_pond", type: "portfolio_page", status: "in_review", title: "Pond draft", content: pondPage });
    const tenant = await getTenant(TENANT_ID);
    const pub = await listProjectCards(tenant);
    expect(pub.length).toBeGreaterThan(0);
    expect(pub.every((c) => c.status === "published")).toBe(true);
    const all = await listProjectCards(tenant, { statuses: ["published", "in_review"] });
    expect(all.some((c) => c.slug === pondPage.slug)).toBe(true);

    const res = await feedGet(new Request("http://t/api/export/portfolio.json?tenant=thorburn"));
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.projects.some((p: { slug: string }) => p.slug === pondPage.slug)).toBe(false);
    expect(body.projects[0].image.url).toMatch(/^https?:\/\//);
    expect((await feedGet(new Request("http://t/api/export/portfolio.json?tenant=nope"))).status).toBe(404);
  });
});
