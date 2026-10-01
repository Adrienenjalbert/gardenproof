import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { getJobDetail, getLeads, getOverview, getReviewQueue, getShellInfo } from "./queries";

const T = "ten_thorburn";
const VIDEO = { template: "reveal", ratio: "9:16", hook: "Circle-cut sandstone", props: {}, durationSec: null };
const pass = [{ id: "consent-photos", ok: true, message: "ok" }];
const noConsent = [{ id: "consent-photos", ok: false, message: "No photo consent yet" }];

beforeAll(async () => {
  const db = await getDb();
  await db.insert(schema.tenants).values({ id: T, slug: "thorburn", name: "Thorburn Landscapes", config: THORBURN_CONFIG });
  await db.insert(schema.customers).values({ id: "cus_h", tenantId: T, firstName: "Harriet", phone: "+447700900101" });
  await db.insert(schema.jobs).values([
    { id: "job_ok", tenantId: T, code: "TL-1", status: "in_review", customerId: "cus_h", title: "Pond, Wimbledon" },
    { id: "job_crew", tenantId: T, code: "TL-2", status: "in_review", title: "Crew-only job" },
  ]);
  await db.insert(schema.testimonials).values({ id: "t1", tenantId: T, jobId: "job_ok", token: "tok1", status: "responded", consentPhotos: true });
  await db.insert(schema.media).values([
    { id: "m_ok", tenantId: T, jobId: "job_ok", stage: "after", kind: "image", storageKey: "t/j/a.jpg", publicKey: "t/j/a.public.jpg", qualityScore: 0.9, qualityNotes: "" },
    { id: "m_blur", tenantId: T, jobId: "job_ok", stage: "after", kind: "image", storageKey: "t/j/b.jpg", publicKey: "t/j/b.public.jpg", qualityNotes: "needs blur (number plate)" },
  ]);
  await db.insert(schema.assets).values([
    { id: "a_page", tenantId: T, jobId: "job_ok", type: "portfolio_page", status: "published", title: "Pond page", content: { slug: "pond-wimbledon" }, checks: pass },
    { id: "a_vid", tenantId: T, jobId: "job_ok", type: "video", status: "in_review", title: "Reveal · 9:16", content: VIDEO, checks: pass },
    { id: "a_ad", tenantId: T, jobId: "job_ok", type: "ad_copy", status: "published", title: "Ad copy — craft", content: {}, checks: pass },
    ...[1, 2, 3].map((n) => ({ id: `a_crew${n}`, tenantId: T, jobId: "job_crew", type: "video" as const, status: "in_review" as const, title: `crew ${n}`, content: VIDEO, checks: noConsent })),
  ]);
  const day = 864e5;
  await db.insert(schema.leads).values([
    // Credited to a VIDEO via stored assetId (QA B2: used to be dropped).
    { id: "l1", tenantId: T, source: "facebook", medium: "paid_social", assetId: "a_vid", content: "asset_a_vid", createdAt: new Date(Date.now() - day),
      attribution: { first: { source: "facebook", medium: "paid_social", content: "asset_a_vid" }, last: { source: "google", medium: "organic", landingPage: "/contact/" } } },
    // Credited to ad copy only through last-touch utm_content.
    { id: "l2", tenantId: T, source: "google", medium: "cpc", createdAt: new Date(Date.now() - 2 * day),
      attribution: { first: { source: "google", medium: "cpc" }, last: { source: "google", medium: "cpc", content: "asset_a_ad" } } },
    // Browsed the portfolio page.
    { id: "l3", tenantId: T, source: "google", medium: "organic", projectSlug: "pond-wimbledon", createdAt: new Date(Date.now() - 3 * day) },
    { id: "l4", tenantId: T, source: "direct", createdAt: new Date(Date.now() - 4 * day) },
  ]);
  await db.insert(schema.tasks).values([
    { id: "tsk_render", tenantId: T, type: "video.render_asset", payload: { assetId: "a_vid" }, status: "running", attempts: 1 },
    { id: "tsk_gen", tenantId: T, type: "pipeline.ready_for_content", payload: { jobId: "job_crew" }, status: "failed", attempts: 3, lastError: "AI timeout" },
  ]);
}, 120_000);

describe("counts exclude consent-blocked drafts (QA B12)", () => {
  it("only counts actionable drafts as waiting for you and explains the blocked job", async () => {
    const o = await getOverview();
    expect(o.counts.assetsInReview).toBe(1);
    expect(o.reviewGroups.map((g) => g.jobId)).toEqual(["job_ok"]);
    expect(o.blockedJobs).toEqual([expect.objectContaining({ jobId: "job_crew", count: 3, block: expect.objectContaining({ kind: "no_customer" }) })]);
    expect((await getShellInfo()).reviewCount).toBe(1);
    const q = await getReviewQueue();
    expect(q.items.map((i) => i.id)).toEqual(["a_vid"]);
    expect(q.blocked.map((b) => b.jobId)).toEqual(["job_crew"]);
  });

  it("lists withheld photos and background work with retry", async () => {
    const o = await getOverview();
    expect(o.flaggedMedia.map((m) => [m.id, m.privacy.reason])).toEqual([["m_blur", "number plate"]]);
    expect(o.background.running).toBe(1);
    expect(o.background.failed).toEqual([expect.objectContaining({ taskId: "tsk_gen", jobTitle: "Crew-only job", error: "AI timeout" })]);
    expect(o.background.active[0]).toMatchObject({ label: "Rendering 9:16…", href: "/ops/jobs/job_ok?tab=assets#asset-a_vid" });
  });
});

describe("job detail", () => {
  it("never hands out original or withheld files on public URLs", async () => {
    const d = await getJobDetail("job_ok");
    const blur = d!.media.find((m) => m.id === "m_blur")!;
    expect(blur.publicUrl).toBeNull();
    expect(blur.url).toBe("/ops/media/m_blur");
    expect(blur.originalUrl).toBe("/ops/media/m_blur?v=original");
    const ok = d!.media.find((m) => m.id === "m_ok")!;
    expect(ok.url).toContain("a.public.jpg");
    expect(d!.consent).toBeNull();
    expect(d!.tasks.map((t) => t.taskId)).toEqual(["tsk_render"]);
  });
  it("explains a crew-only job", async () => {
    const d = await getJobDetail("job_crew");
    expect(d!.consent?.kind).toBe("no_customer");
    expect(d!.tasks.map((t) => t.label)).toEqual(["Content generation failed — retry"]);
  });
});

describe("getLeads (QA B2)", () => {
  it("credits any asset type and shows first vs last touch", async () => {
    const { leads, breakdownText } = await getLeads();
    const byId = Object.fromEntries(leads.map((l) => [l.id, l]));
    expect(byId.l1.attributed).toMatchObject({ assetId: "a_vid", type: "video", label: "Reveal video · 9:16" });
    expect(byId.l1.project?.assetId).toBe("a_page"); // the page for the video's job
    expect(byId.l1.firstTouch).toMatchObject({ source: "facebook" });
    expect(byId.l1.lastTouch).toMatchObject({ source: "google", landingPage: "/contact/" });
    expect(byId.l2.attributed).toMatchObject({ type: "ad_copy", label: "Ad copy — craft" });
    expect(byId.l3.attributed).toBeNull();
    expect(byId.l3.project?.assetId).toBe("a_page");
    expect(byId.l4.fromPortfolio).toBe(false);
    expect(breakdownText).toBe("1 enquiry from a portfolio page, 1 from a video ad, 1 from a text ad");
  });
});
