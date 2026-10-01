/** Consent at render time (quote / first name / withdrawal), preview access (P1-3) and unpublishAsset (P1-8). */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { GET as feedGet } from "@/app/api/export/portfolio.json/route";
import { GET as exportGet } from "@/app/api/export/[assetId]/route";
import { env } from "@/lib/config";
import { createSessionToken } from "@/lib/dashboard/auth";
import { publishAsset, unpublishAsset } from "@/lib/publish";
import { applyConsent, consentFromRows, NO_CONSENT } from "@/lib/publish/consent";
import { listProjectCards, loadPreview } from "@/lib/publish/data";
import { buildPortfolioJsonLd } from "@/lib/publish/jsonld";
import { buildPortfolioView, type PortfolioView } from "@/lib/publish/view";
import { getTenant } from "@/lib/tenants";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { patioGbp, patioPage } from "../fixtures/mod-d";
import { insertAsset, insertImage, insertJob, insertTestimonial, seedBase, TENANT_ID } from "../fixtures/mod-d-db";

// The preview page reads the session cookie through next/headers.
const jar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "gp_session" && jar.token ? { value: jar.token } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const PASSWORD = "pw-for-tests";
beforeAll(seedBase, 120_000);
beforeEach(() => vi.stubEnv("ADMIN_PASSWORD", PASSWORD));
afterEach(() => {
  vi.unstubAllEnvs();
  jar.token = undefined;
});

const page = (jobId: string, mediaId: string) => ({
  ...patioPage,
  slug: `${jobId.replace(/_/g, "-")}-page`,
  gallery: [{ mediaId, stage: "after" as const, alt: "Finished patio" }],
});

async function row(id: string) {
  const [a] = await (await getDb()).select().from(schema.assets).where(eq(schema.assets.id, id));
  return a;
}

describe("applyConsent / consentFromRows (pure)", () => {
  const view: PortfolioView = buildPortfolioView(
    patioPage,
    [{ id: "med_patio_a1", stage: "after", kind: "image", publicKey: "k.jpg", width: 1280, height: 720 }],
    { assetId: "a", config: THORBURN_CONFIG, appUrl: "https://app.example", mediaUrl: (k) => `/m/${k}` },
  );
  const yes = { quote: true, firstName: true, photos: true, withdrawn: false };

  it("keeps everything the homeowner agreed to", () => {
    expect(applyConsent(view, yes)).toEqual(view);
  });
  it("drops the quote (and the Review JSON-LD) without an explicit quote consent", () => {
    for (const c of [NO_CONSENT, { ...yes, quote: false }]) {
      const v = applyConsent(view, c);
      expect(v.testimonial).toBeNull();
      expect(JSON.stringify(buildPortfolioJsonLd(v))).not.toContain("Review");
    }
  });
  it("replaces the first name with 'Homeowner' when the name was not agreed", () => {
    const v = applyConsent(view, { ...yes, firstName: false });
    expect(v.testimonial).toMatchObject({ attribution: "Homeowner, Putney", quote: patioPage.testimonial!.quote });
    expect(JSON.stringify(v)).not.toContain("James");
  });
  it("shows nothing personal at all once consent is withdrawn", () => {
    const v = applyConsent(view, { ...yes, withdrawn: true });
    expect(v).toMatchObject({ testimonial: null, hero: null, beforeAfter: null, gallery: [] });
    expect(applyConsent(view, { ...yes, photos: false }).hero).toBeNull();
  });
  it("lets any withdrawal win and otherwise uses the latest answered request", () => {
    const r = (o: object) => ({ jobId: "j", status: "responded" as const, consentPhotos: true, consentQuote: true, consentFirstName: true, withdrawnAt: null, ...o });
    expect(consentFromRows([])).toEqual(NO_CONSENT);
    expect(consentFromRows([r({ status: "sent" })])).toEqual(NO_CONSENT);
    expect(consentFromRows([r({ consentQuote: null })]).quote).toBe(false);
    expect(consentFromRows([r({}), r({ withdrawnAt: new Date() })]).withdrawn).toBe(true);
    expect(consentFromRows([r({ consentFirstName: false }), r({})]).firstName).toBe(false);
  });
});

describe("consent in the loaded views (preview, grid, feed)", () => {
  it("hides the quote when consentQuote is false and the name when consentFirstName is false", async () => {
    const job = await insertJob("job_cons_a");
    const img = await insertImage(job, 1);
    await insertTestimonial(job, { consentQuote: false });
    const id = await insertAsset({ jobId: job, type: "portfolio_page", status: "published", title: "P", content: page(job, img.id) });
    expect((await loadPreview(id))!.view).toMatchObject({ kind: "portfolio_page", testimonial: null });

    const job2 = await insertJob("job_cons_b");
    const img2 = await insertImage(job2, 1);
    await insertTestimonial(job2, { consentFirstName: false });
    const id2 = await insertAsset({ jobId: job2, type: "portfolio_page", status: "published", title: "P", content: page(job2, img2.id) });
    const v = (await loadPreview(id2))!.view as PortfolioView;
    expect(v.testimonial?.attribution).toBe("Homeowner, Putney");
    const card = (await listProjectCards(await getTenant(TENANT_ID))).find((c) => c.assetId === id2);
    expect(card?.rating).toBe(5);
  });

  it("never puts storage keys in the public feed or views", async () => {
    const job = await insertJob("job_cons_keys");
    const img = await insertImage(job, 1);
    await insertTestimonial(job);
    const id = await insertAsset({ jobId: job, type: "portfolio_page", status: "published", title: "P", content: page(job, img.id) });
    const view = (await loadPreview(id))!.view as PortfolioView;
    expect(view.hero).not.toHaveProperty("key");
    expect(view.hero?.src).toBe(`/api/media/${img.publicKey}`);
    const feed = await (await feedGet(new Request("http://t/api/export/portfolio.json?tenant=thorburn"))).text();
    expect(feed).toContain(img.publicKey); // inside the URL only
    expect(feed).not.toMatch(/"key"\s*:/);
    expect(feed).not.toContain(img.storageKey);
  });
});

describe("/preview access (P1-3) and withdrawal", () => {
  const render = async (id: string) => {
    const { default: PreviewPage } = await import("@/app/(public)/preview/[assetId]/page");
    return PreviewPage({ params: Promise.resolve({ assetId: id }) } as PageProps<"/preview/[assetId]">);
  };

  it("shows drafts to the signed-in operator only; published pages to everyone", async () => {
    const job = await insertJob("job_prev_a");
    const img = await insertImage(job, 1);
    const draft = await insertAsset({ jobId: job, type: "portfolio_page", status: "in_review", title: "Draft", content: page(job, img.id) });
    await expect(render(draft)).rejects.toThrow("NEXT_NOT_FOUND");
    jar.token = "123.forged";
    await expect(render(draft)).rejects.toThrow("NEXT_NOT_FOUND");
    jar.token = await createSessionToken(PASSWORD);
    await expect(render(draft)).resolves.toBeTruthy();

    jar.token = undefined;
    const live = await insertAsset({ jobId: job, type: "portfolio_page", status: "approved", title: "Live", content: page(job, img.id) });
    await publishAsset(live);
    await expect(render(live)).resolves.toBeTruthy();
  });

  it("takes a withdrawn job off every public surface even before it is unpublished", async () => {
    const job = await insertJob("job_prev_w");
    const img = await insertImage(job, 1);
    await insertTestimonial(job);
    const id = await insertAsset({ jobId: job, type: "portfolio_page", status: "published", title: "W", content: page(job, img.id) });
    const tenant = await getTenant(TENANT_ID);
    expect((await listProjectCards(tenant)).some((c) => c.assetId === id)).toBe(true);

    await insertTestimonial(job, { withdrawnAt: new Date() });
    expect((await listProjectCards(tenant)).some((c) => c.assetId === id)).toBe(false);
    const model = await loadPreview(id);
    expect(model?.isPublic).toBe(false);
    await expect(render(id)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("unpublishAsset (consent withdrawal)", () => {
  it("local mode: marks the asset rejected, logs it and stops serving it", async () => {
    const job = await insertJob("job_unpub_local");
    const img = await insertImage(job, 1);
    const pageId = await insertAsset({ jobId: job, type: "portfolio_page", status: "approved", title: "Page", content: page(job, img.id) });
    const gbpId = await insertAsset({ jobId: job, type: "gbp_post", status: "approved", title: "GBP", content: patioGbp });
    await publishAsset(pageId);
    await publishAsset(gbpId);

    for (const id of [pageId, gbpId]) {
      await expect(unpublishAsset(id, "homeowner asked on WhatsApp")).resolves.toMatchObject({ mode: "local" });
      expect(await row(id)).toMatchObject({ status: "rejected", reviewNotes: "Withdrawn: homeowner asked on WhatsApp" });
      const events = await (await getDb())
        .select()
        .from(schema.events)
        .where(and(eq(schema.events.entityId, id), eq(schema.events.type, "asset.unpublished")));
      expect(events[0].data).toMatchObject({ reason: "homeowner asked on WhatsApp", previousStatus: "published" });
    }
    expect((await loadPreview(pageId))?.isPublic).toBe(false);
    const ctx = { params: Promise.resolve({ assetId: gbpId }) } as RouteContext<"/api/export/[assetId]">;
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect((await exportGet(new Request(`http://t/api/export/${gbpId}`), ctx)).status).toBe(404);
    // idempotent
    await expect(unpublishAsset(pageId, "again")).resolves.toMatchObject({ mode: "local" });
  });

  describe("WordPress mode", () => {
    const saved = { ...env.wordpress };
    afterEach(() => {
      Object.assign(env.wordpress, saved);
      vi.unstubAllGlobals();
    });

    it("sets the post to draft and deletes the uploaded photos", async () => {
      const calls: { method: string; path: string; body?: unknown }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input));
          const method = init?.method ?? "GET";
          const path = url.pathname.replace("/wp-json/wp/v2", "") + url.search;
          calls.push({ method, path, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
          const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "content-type": "application/json" } });
          if (method === "GET" && path.startsWith("/media?slug=")) return json([{ id: 77, source_url: "https://wp.test/u/77.jpg" }]);
          return json({ id: 1 });
        }),
      );
      Object.assign(env.wordpress, { baseUrl: "https://wp.test", user: "gp", appPassword: "x y z" });

      const job = await insertJob("job_unpub_wp");
      const img = await insertImage(job, 1);
      const id = await insertAsset({ jobId: job, type: "portfolio_page", status: "published", title: "WP", content: page(job, img.id) });
      await (await getDb()).update(schema.assets).set({ externalId: "555" }).where(eq(schema.assets.id, id));

      const result = await unpublishAsset(id, "consent withdrawn");
      expect(result).toMatchObject({ mode: "wordpress", deletedMedia: 1 });
      expect(calls).toContainEqual({ method: "POST", path: "/gp_project/555", body: { status: "draft" } });
      expect(calls.some((c) => c.method === "DELETE" && c.path === "/media/77?force=true")).toBe(true);
      expect((await row(id)).status).toBe("rejected");
    });

    it("leaves the asset untouched when WordPress fails, so a retry can finish", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "x", message: "down" }), { status: 500 })));
      Object.assign(env.wordpress, { baseUrl: "https://wp.test", user: "gp", appPassword: "x y z" });
      const job = await insertJob("job_unpub_wp_fail");
      const img = await insertImage(job, 1);
      const id = await insertAsset({ jobId: job, type: "portfolio_page", status: "published", title: "WP", content: page(job, img.id) });
      await (await getDb()).update(schema.assets).set({ externalId: "556" }).where(eq(schema.assets.id, id));
      await expect(unpublishAsset(id, "x")).rejects.toThrow(/WordPress 500/);
      expect((await row(id)).status).toBe("published");
    });
  });
});
