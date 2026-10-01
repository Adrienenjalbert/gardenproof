import { beforeAll, describe, expect, it } from "vitest";
import golden from "../../../evals/golden.json";
import { ASSET_CONTENT_SCHEMAS } from "@/lib/domain";
import { decideConsent } from "@/lib/content/consent";
import { buildContentContext } from "@/lib/content/context";
import { EnrichmentDraftSchema } from "@/lib/content/drafts";
import { JOB_ASSET_TYPES, writeJobAsset } from "@/lib/content/generate";
import type { MediaStage } from "@/lib/domain";
import type { Testimonial } from "@/db/schema";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { DEMO_CHECK, mockEnrichment } from "./mock";

beforeAll(() => {
  process.env.AI_PROVIDER = "mock";
});

const publicCases = golden.cases.filter((c) => c.expect.public);

function contextFor(c: (typeof golden.cases)[number]) {
  const consent = decideConsent({
    job: { area: c.area, postcode: c.postcode },
    customer: c.customer,
    testimonial: c.testimonial
      ? ({ ...c.testimonial, withdrawnAt: c.testimonial.withdrawnAt ? new Date(c.testimonial.withdrawnAt) : null } as Pick<
          Testimonial,
          "status" | "rating" | "quote" | "consentPhotos" | "consentArea" | "consentFirstName" | "consentQuote" | "withdrawnAt"
        >)
      : null,
    config: THORBURN_CONFIG,
  });
  const ctx = buildContentContext({
    job: { id: c.id, code: "TL-1", service: c.service, completedAt: new Date("2026-09-01"), createdAt: new Date("2026-08-01") },
    enrichment: null,
    media: c.media.map((m) => ({
      id: m.id,
      stage: m.stage as MediaStage,
      kind: "image" as const,
      publicKey: `k/${m.id}`,
      blurredKey: null,
      privacyClearedAt: m.privacyCleared ? new Date("2026-09-02") : null,
      isHero: false,
      qualityScore: 0.8,
      qualityNotes: m.qualityNotes,
    })),
    crewNotes: c.brief,
    consent,
    config: THORBURN_CONFIG,
  });
  return { ctx, consent };
}

describe("mock copywriter", () => {
  it.each(publicCases.map((c) => [c.id, c] as const))("%s: every asset matches its contract and passes lint", async (_id, c) => {
    const { ctx, consent } = contextFor(c);
    for (const type of JOB_ASSET_TYPES) {
      const w = await writeJobAsset(type, ctx, consent);
      expect(ASSET_CONTENT_SCHEMAS[type].safeParse(w.content).success).toBe(true);
      expect(w.checks[0]).toEqual(DEMO_CHECK);
      // Reviewer notes (not lint): photo consent pending, thin input asking for crew notes.
      const failed = w.checks.filter((k) => !k.ok && k.id !== "consent-photos" && k.id !== "thin-input");
      expect(failed, `${type}: ${JSON.stringify(failed)}`).toEqual([]);
    }
  });

  it("is deterministic", async () => {
    const { ctx, consent } = contextFor(publicCases[0]);
    const a = await writeJobAsset("ad_copy", ctx, consent);
    const b = await writeJobAsset("ad_copy", ctx, consent);
    expect(a.content).toEqual(b.content);
  });

  it("writes specific, local hooks in the Thorburn style", async () => {
    const { ctx, consent } = contextFor(publicCases[0]);
    const ad = (await writeJobAsset("ad_copy", ctx, consent)).content as { meta: { hooks: string[] } };
    expect(ad.meta.hooks).toContain("Patio specialist in Putney?");
    expect(ad.meta.hooks.every((h) => h.split(/\s+/).length <= 6)).toBe(true);
  });

  it("uses the testimonial verbatim only when allowed", async () => {
    const full = contextFor(publicCases.find((c) => c.id === "patio-putney-full-consent")!);
    const page = (await writeJobAsset("portfolio_page", full.ctx, full.consent)).content as { testimonial: { quote: string } | null };
    expect(page.testimonial?.quote).toBe(publicCases[0].testimonial!.quote);

    const low = contextFor(publicCases.find((c) => c.id === "planting-richmond-3-star")!);
    const lowPage = (await writeJobAsset("portfolio_page", low.ctx, low.consent)).content;
    expect((lowPage as { testimonial: unknown }).testimonial).toBeNull();
    expect(JSON.stringify(lowPage)).not.toMatch(/ran a day over|\bstars?\b/i);

    const noQuote = contextFor(publicCases.find((c) => c.id === "terrace-putney-quote-not-consented")!);
    expect(noQuote.ctx.testimonial).toBeNull();
    for (const type of JOB_ASSET_TYPES) {
      const json = JSON.stringify((await writeJobAsset(type, noQuote.ctx, noQuote.consent)).content);
      expect(json).not.toMatch(/Private note|5\/5|out of 5|“/);
    }
  });

  it("never shortens a quote to fit: a long quote is left out of ad primary text but kept whole elsewhere", async () => {
    const base = publicCases.find((c) => c.id === "patio-putney-full-consent")!;
    const quote = "Marco's team turned a jungle into the garden we'd hoped for — the pond is the first thing we see every morning and the terrace is where we eat all summer.";
    const { ctx, consent } = contextFor({ ...base, testimonial: { ...base.testimonial!, quote } } as typeof base);
    const ad = (await writeJobAsset("ad_copy", ctx, consent)).content as { meta: { primaryTexts: string[] } };
    expect(ad.meta.primaryTexts.some((t) => t.includes("“"))).toBe(false);
    const social = (await writeJobAsset("social_pack", ctx, consent)).content as { captions: string[] };
    expect(social.captions[0]).toContain(`“${quote}” – Sophie, Putney.`);
    const gbp = await writeJobAsset("gbp_post", ctx, consent);
    expect((gbp.content as { text: string }).text).toContain(quote);
    expect(gbp.checks.find((k) => k.id === "quote-verbatim")?.ok).toBe(true);
  });

  it("thin input (no brief): short honest copy, no filler or invented craft", async () => {
    const { ctx, consent } = contextFor(publicCases.find((c) => c.id === "garden-design-wimbledon-thin")!);
    const page = await writeJobAsset("portfolio_page", ctx, consent);
    expect(page.checks.find((k) => k.id === "thin-input")?.message).toMatch(/Add crew notes/);
    const all = JSON.stringify(await Promise.all(JOB_ASSET_TYPES.map(async (t) => (await writeJobAsset(t, ctx, consent)).content)));
    expect(all).not.toMatch(/built around a garden design|dead level|well-compacted|every millimetre/);
    expect((page.content as { h1: string }).h1).toBe("Garden design & build in South West London");
  });
});

describe("mock enrichment", () => {
  it("extracts facts from crew notes, scores images from metrics and picks heroes by stage", () => {
    const out = EnrichmentDraftSchema.parse(
      mockEnrichment({
        crewNotes: golden.cases[1].brief,
        jobService: null,
        serviceKeys: THORBURN_CONFIG.services.map((s) => s.key),
        images: [
          { mediaId: "b", stage: "before", metrics: { width: 720, height: 720, brightness: 0.44, sharpness: 3.2 } },
          { mediaId: "a_dark", stage: "after", metrics: { width: 720, height: 720, brightness: 0.1, sharpness: 0.7 } },
          { mediaId: "a", stage: "after", metrics: { width: 720, height: 720, brightness: 0.49, sharpness: 3.9 } },
        ],
      }),
    );
    expect(out.service).toBe("full_design");
    expect(out.materials).toContain("self-binding gravel");
    expect(out.heroBeforeMediaId).toBe("b");
    expect(out.heroAfterMediaId).toBe("a");
    expect(out.images.find((i) => i.mediaId === "a_dark")?.notes).toContain("too dark");
  });
});
