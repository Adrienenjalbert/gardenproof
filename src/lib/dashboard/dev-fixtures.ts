/**
 * Dev-only fixtures so every dashboard state can be reviewed without running the whole pipeline.
 * - job_patio: one asset of every type (validated against ASSET_CONTENT_SCHEMAS, built only from seed facts),
 *   four-part consent wording, a photo withheld for blur, an unscreened photo, background tasks in every state.
 * - job_pond: responded then WITHDRAWN testimonial (P1-8), a flagged before photo.
 * - fx_job_crew: crew-only job with consent-blocked drafts and no homeowner (P0-4 / QA B12).
 * - leads credited to a portfolio page, a video ad, ad copy (first vs last touch) and an untracked one (QA B2).
 * Idempotent (ids prefixed "fx_"). Run after `pnpm seed`, ideally with the server's WORKER=off so the fake
 * tasks keep their states:
 *   PGLITE_DIR=... STORAGE_DIR=... pnpm tsx src/lib/dashboard/dev-fixtures.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { eq, like } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ASSET_CONTENT_SCHEMAS, type AssetType } from "@/lib/domain";
import { objectPath } from "@/lib/storage";
import { consentWording } from "@/lib/testimonials/consent";

const T = "ten_thorburn";
const JOB = "job_patio";
const HERO = "med_patio_a1";
const QUOTE =
  "Stephen's team were tidy, on time and the patio is exactly what we pictured. We use the garden every evening now.";

type Check = { id: string; ok: boolean; message: string };
const passing = (extra: Check[] = []): Check[] => [
  { id: "consent.photos", ok: true, message: "Homeowner consented to photos" },
  { id: "consent.area", ok: true, message: "Area name (Putney) consented; no street address" },
  { id: "facts.traceable", ok: true, message: "All materials and features trace to crew notes" },
  { id: "voice.banned_phrases", ok: true, message: "No banned phrases" },
  ...extra,
];

const CONTENT: Record<AssetType, { title: string; content: unknown; checks: Check[] }> = {
  portfolio_page: {
    title: "Sandstone circle patio & brick raised beds, Putney",
    checks: passing([{ id: "seo.title_length", ok: true, message: "SEO title 58/65 characters" }]),
    content: {
      slug: "sandstone-circle-patio-brick-raised-beds-putney",
      seoTitle: "Indian Sandstone Circle Patio & Raised Beds, Putney",
      metaDescription:
        "An Indian sandstone patio laid in a circle pattern with a red brick band, curved brick raised beds, a striped lawn and a timber pergola in Putney.",
      h1: "A sandstone circle patio with curved brick beds in Putney",
      summary:
        "Thorburn Landscapes laid an Indian sandstone patio in a circle pattern with a red brick band for a family garden in Putney. Two curved brick raised beds were built and planted, a new striped lawn was laid and a timber pergola added. The work took two and a half weeks.",
      sections: {
        brief: "The homeowners wanted a patio they would actually use in the evenings, with planting close to the house.",
        challenge: "Fitting a circular paving pattern and two curved raised beds into a rectangular garden without losing lawn.",
        solution:
          "Indian sandstone laid in a circle pattern and framed with a red brick band; two curved brick raised beds planted up; new turf mown in stripes; a timber pergola at the far end.",
        result: "A patio exactly as the family pictured it, used every evening.",
      },
      facts: {
        service: "Patios & paving",
        area: "Putney",
        materials: ["Indian sandstone", "red brick", "timber"],
        features: ["circle-pattern patio", "brick band", "curved brick raised beds", "striped lawn", "timber pergola"],
        duration: "2.5 weeks",
      },
      testimonial: { quote: QUOTE, attribution: "James, Putney", rating: 5 },
      gallery: [{ mediaId: HERO, stage: "after", alt: "Indian sandstone circle patio with red brick band and curved brick raised beds, Putney" }],
      beforeAfter: null,
      faqs: [
        { q: "How long did the patio take?", a: "Two and a half weeks, including the raised beds, lawn and pergola." },
      ],
      cta: { text: "Book a design consultation", url: "https://www.thorburnlandscapes.co.uk/contact/" },
      internalLinks: [{ text: "More patios & paving", url: "/projects/?service=patio_paving" }],
    },
  },
  ad_copy: {
    title: "Ad copy — craft angle",
    checks: passing([{ id: "limits.meta_primary", ok: false, message: "1 primary text is over 125 characters" }]),
    content: {
      angle: "craft",
      meta: {
        hooks: ["Circle-cut sandstone in Putney", "From lawn to evening patio", "Curved brick, laid by hand"],
        primaryTexts: [
          "Indian sandstone laid in a circle, framed with a red brick band. A Putney garden the family now uses every evening.",
          "Two curved brick raised beds, a striped lawn and a timber pergola — finished in two and a half weeks in Putney.",
          "“Tidy, on time and exactly what we pictured.” James rated his new sandstone patio in Putney 5 stars. See the full project and book a design consultation.",
        ],
        headlines: ["Sandstone patio, Putney", "Curved brick raised beds", "Book a design consultation"],
      },
      pmax: {
        headlines: ["Sandstone Patios Putney", "Curved Brick Raised Beds", "Book a Garden Consultation"],
        longHeadlines: ["Indian sandstone circle patio with red brick band, laid in Putney in 2.5 weeks"],
        descriptions: [
          "Circle-pattern Indian sandstone, curved brick beds and a timber pergola in Putney.",
          "Rated 5 stars by a Putney homeowner. Book a design consultation today.",
        ],
      },
    },
  },
  social_pack: {
    title: "Instagram carousel & captions",
    checks: passing(),
    content: {
      carouselOrder: [HERO, HERO, HERO],
      captions: [
        "Indian sandstone, laid in a circle and framed with a red brick band. Two curved brick raised beds, a freshly striped lawn and a timber pergola to finish. Putney, two and a half weeks.",
        "“We use the garden every evening now.” — James, Putney. Sandstone circle patio, curved brick beds, timber pergola.",
      ],
      hashtags: ["#putneygardens", "#sandstonepatio", "#gardendesignlondon", "#brickraisedbeds"],
      reelCoverText: "Putney: the circle patio",
    },
  },
  gbp_post: {
    title: "Google Business post — Putney patio",
    checks: passing(),
    content: {
      text:
        "New project in Putney: an Indian sandstone patio laid in a circle pattern with a red brick band, two curved brick raised beds, a new striped lawn and a timber pergola. Finished in two and a half weeks. “Tidy, on time and exactly what we pictured.” — James",
      mediaId: HERO,
      ctaType: "BOOK",
      ctaUrl: "https://www.thorburnlandscapes.co.uk/contact/",
    },
  },
  video: {
    title: "Reveal · 9:16",
    checks: passing([{ id: "video.duration", ok: true, message: "12 s — within 15 s reel limit" }]),
    content: {
      template: "reveal",
      ratio: "9:16",
      hook: "Circle-cut sandstone in Putney",
      props: { afterMediaId: HERO, area: "Putney", quote: QUOTE },
      durationSec: 6,
    },
  },
  seo_article: {
    title: "Sandstone patios in Putney: what a circle pattern involves",
    checks: passing([{ id: "consent.first_name", ok: false, message: "First name used but consent not confirmed for articles" }]),
    content: {
      slug: "sandstone-patio-circle-pattern-putney",
      seoTitle: "Sandstone Circle Patios in Putney: A Real Project",
      metaDescription: "How an Indian sandstone circle patio with a red brick band and curved brick raised beds came together in Putney.",
      h1: "Sandstone circle patios in Putney",
      targetKeyword: "sandstone patio putney",
      bodyMarkdown:
        "## The garden\n\nA family garden in Putney with a tired lawn and nowhere to sit in the evening.\n\n## What we built\n\n- **Indian sandstone** laid in a circle pattern\n- A **red brick band** framing the circle\n- Two **curved brick raised beds**, planted up\n- A new **striped lawn** and a **timber pergola**\n\nThe work took two and a half weeks.",
      relatedJobIds: [JOB],
      faqs: [],
    },
  },
};

/** Short Ken Burns mp4 from the patio photo so the video card has something real to play. */
function makeVideo(): { fileKey: string | null; thumbKey: string } {
  const thumbKey = "thorburn/job_patio/after-1.jpg";
  const fileKey = "thorburn/job_patio/fx-reveal-9x16.mp4";
  try {
    const out = objectPath(fileKey);
    if (!fs.existsSync(out)) {
      execFileSync("ffmpeg", [
        "-y", "-loop", "1", "-i", objectPath(thumbKey), "-t", "6", "-r", "25",
        "-vf", "scale=-2:1280,zoompan=z='min(zoom+0.0012,1.15)':d=150:s=720x1280:fps=25,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", out,
      ], { stdio: "ignore" });
    }
    return { fileKey, thumbKey };
  } catch {
    return { fileKey: null, thumbKey };
  }
}

async function main() {
  const db = await getDb();
  await db.delete(schema.tasks).where(like(schema.tasks.id, "fx_%"));
  await db.delete(schema.events).where(like(schema.events.id, "fx_%"));
  await db.delete(schema.leads).where(like(schema.leads.id, "fx_%"));
  await db.delete(schema.messages).where(like(schema.messages.id, "fx_%"));
  await db.delete(schema.testimonials).where(like(schema.testimonials.id, "fx_%"));
  await db.delete(schema.assets).where(like(schema.assets.id, "fx_%"));
  await db.delete(schema.media).where(like(schema.media.id, "fx_%"));
  await db.delete(schema.jobs).where(like(schema.jobs.id, "fx_%"));

  await db
    .update(schema.jobs)
    .set({
      status: "in_review",
      subServices: ["sandstone", "brick edging"],
      enrichment: {
        service: "patio_paving",
        subServices: ["sandstone", "brick edging", "raised beds", "pergola"],
        features: ["circle-pattern patio", "red brick band", "curved brick raised beds", "striped lawn", "timber pergola"],
        materials: ["Indian sandstone", "red brick", "timber"],
        plants: [],
        durationDays: 17,
        challenge: "Fitting a circular pattern and curved beds into a rectangular garden.",
        result: "A sandstone circle patio with curved brick beds the family uses every evening.",
        style: "classic",
        heroBeforeMediaId: null,
        heroAfterMediaId: HERO,
        confidence: 0.82,
      },
    })
    .where(eq(schema.jobs.id, JOB));
  await db.update(schema.media).set({ qualityScore: 0.91, isHero: true }).where(eq(schema.media.id, HERO));
  await db
    .update(schema.media)
    .set({ qualityScore: 0.48, qualityNotes: "needs blur (neighbour's window); slightly dark", privacyClearedAt: null, tags: [] })
    .where(eq(schema.media.id, "med_pond_b1"));
  await db.update(schema.media).set({ qualityScore: 0.86, qualityNotes: "" }).where(eq(schema.media.id, "med_pond_a1"));

  // Two more patio stills (same file): one flagged for blur, one never screened.
  const [patioHero] = await db.select().from(schema.media).where(eq(schema.media.id, HERO));
  await db.insert(schema.media).values([
    { ...patioHero, id: "fx_med_patio_blur", isHero: false, qualityScore: 0.8, qualityNotes: "needs blur (number plate on the drive)", tags: [], createdAt: new Date(Date.now() - 60_000) },
    { ...patioHero, id: "fx_med_patio_new", isHero: false, qualityScore: null, qualityNotes: null, tags: [], createdAt: new Date(Date.now() - 30_000) },
  ]);

  // Four-part consent evidence on the patio testimonial (P0-3).
  const patioAnswers = { consentPhotos: true, consentArea: true, consentFirstName: true, consentQuote: true };
  await db
    .update(schema.testimonials)
    .set({ ...patioAnswers, withdrawnAt: null, consentWording: consentWording("Thorburn Landscapes", "Putney", patioAnswers) })
    .where(eq(schema.testimonials.jobId, JOB));

  const video = makeVideo();
  let n = 0;
  for (const [type, spec] of Object.entries(CONTENT) as [AssetType, (typeof CONTENT)[AssetType]][]) {
    const content = ASSET_CONTENT_SCHEMAS[type].parse(spec.content) as Record<string, unknown>;
    await db.insert(schema.assets).values({
      id: `fx_${type}`,
      tenantId: T,
      jobId: JOB,
      type,
      status: "in_review",
      title: spec.title,
      content,
      checks: spec.checks,
      fileKey: type === "video" ? video.fileKey : null,
      thumbnailKey: type === "video" ? video.thumbKey : null,
      createdAt: new Date(Date.now() - 3600_000 + n++ * 1000),
    });
  }

  await db.insert(schema.messages).values({
    id: "fx_msg_held",
    tenantId: T,
    direction: "out",
    channel: "simulator",
    fromNumber: "+447700900000",
    toNumber: "+447700900101",
    body:
      "Hi Harriet, it's Thorburn Landscapes. Thanks for having Marco's team in Wimbledon. Could you spare 30 seconds to rate the job? https://gardenproof.local/r/demo",
    status: "held",
    createdAt: new Date(Date.now() - 50 * 60_000),
  });

  const day = 864e5;
  const ago = (ms: number) => new Date(Date.now() - ms);

  // Pond: the homeowner responded, then asked for everything to come down (P1-8).
  const pondAnswers = { consentPhotos: true, consentArea: true, consentFirstName: true, consentQuote: true };
  await db.insert(schema.testimonials).values({
    id: "fx_tst_pond",
    tenantId: T,
    jobId: "job_pond",
    customerId: "cus_harriet",
    token: "fx_pond_token_000000000001",
    status: "responded",
    rating: 5,
    quote: "Marco's team turned a jungle into the garden we'd hoped for. The pond is the first thing everyone notices.",
    consentPhotos: false,
    consentArea: false,
    consentFirstName: false,
    consentQuote: false,
    consentWording: consentWording("Thorburn Landscapes", "Wimbledon", pondAnswers),
    consentedAt: ago(3 * day),
    sentAt: ago(3.2 * day),
    respondedAt: ago(3 * day),
    withdrawnAt: ago(2 * 3600_000),
  });
  await db.insert(schema.events).values([
    { id: "fx_ev_pond_consent", tenantId: T, type: "consent.recorded", entity: "testimonial", entityId: "fx_tst_pond", actor: "cus_harriet", data: { jobId: "job_pond", ...pondAnswers }, createdAt: ago(3 * day) },
    { id: "fx_ev_pond_withdrawn", tenantId: T, type: "consent.withdrawn", entity: "testimonial", entityId: "fx_tst_pond", actor: "agency", data: { jobId: "job_pond", reason: "Asked by phone — selling the house next month" }, createdAt: ago(2 * 3600_000) },
  ]);

  // Crew-only job: captured on WhatsApp with no homeowner, drafts blocked on consent (P0-4 / QA B12).
  const [pond] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, "job_pond"));
  await db.insert(schema.jobs).values({
    ...pond,
    id: "fx_job_crew",
    code: "TL-8558",
    customerId: null,
    status: "in_review",
    title: "Garden design & build, Wimbledon",
    enrichment: null,
    completedAt: ago(5 * 3600_000),
    createdAt: ago(6 * 3600_000),
    updatedAt: ago(4 * 3600_000),
  });
  const pondMedia = await db.select().from(schema.media).where(eq(schema.media.jobId, "job_pond"));
  await db.insert(schema.media).values(
    pondMedia.map((m, i) => ({ ...m, id: `fx_med_crew_${i}`, jobId: "fx_job_crew", qualityNotes: "", qualityScore: 0.8, tags: [], privacyClearedAt: null })),
  );
  const blocked = [{ id: "consent-photos", ok: false, message: "No homeowner consent to use these photos" }];
  await db.insert(schema.assets).values(
    (["portfolio_page", "social_pack", "gbp_post"] as const).map((type, i) => ({
      id: `fx_crew_${type}`,
      tenantId: T,
      jobId: "fx_job_crew",
      type,
      status: "in_review" as const,
      title: `${CONTENT[type].title.replace(/Putney|putney/g, "Wimbledon")}`,
      content: ASSET_CONTENT_SCHEMAS[type].parse(CONTENT[type].content) as Record<string, unknown>,
      checks: blocked,
      createdAt: ago(4 * 3600_000 - i * 1000),
    })),
  );

  // Background work in every state (keep the server's WORKER=off while reviewing these).
  await db.insert(schema.tasks).values([
    { id: "fx_tsk_render", tenantId: T, type: "video.render_asset", payload: { assetId: "fx_video" }, status: "running", attempts: 1, lockedAt: new Date(), createdAt: ago(40_000) },
    { id: "fx_tsk_publish_q", tenantId: T, type: "asset.publish", payload: { assetId: "fx_gbp_post" }, status: "queued", createdAt: ago(20_000) },
    { id: "fx_tsk_publish_f", tenantId: T, type: "asset.publish", payload: { assetId: "fx_social_pack" }, status: "failed", attempts: 3, lastError: "Instagram export: carousel image missing (fx)", createdAt: ago(3600_000), finishedAt: ago(3500_000) },
    { id: "fx_tsk_gen_f", tenantId: T, type: "pipeline.ready_for_content", payload: { jobId: "fx_job_crew" }, status: "failed", attempts: 3, lastError: "AI request timed out after 3 attempts (fx)", createdAt: ago(2 * 3600_000), finishedAt: ago(2 * 3600_000 - 60_000) },
  ]);

  await db.insert(schema.leads).values([
    { id: "fx_lead_1", tenantId: T, source: "facebook", medium: "paid_social", campaign: "putney-patio-craft", content: "fx_ad_copy",
      landingPage: "/projects/sandstone-circle-patio-brick-raised-beds-putney", projectSlug: "sandstone-circle-patio-brick-raised-beds-putney",
      assetId: "fx_portfolio_page", name: "Sophie Hart", postcode: "SW15 6PR", service: "patio_paving", createdAt: new Date(Date.now() - 1 * day) },
    { id: "fx_lead_2", tenantId: T, source: "google", medium: "organic", landingPage: "/projects/sandstone-circle-patio-brick-raised-beds-putney",
      projectSlug: "sandstone-circle-patio-brick-raised-beds-putney", name: "Tom Ellis", postcode: "SW18 2AA", service: "full_design", createdAt: new Date(Date.now() - 3 * day) },
    { id: "fx_lead_3", tenantId: T, source: "google", medium: "cpc", campaign: "pmax-sw-london", landingPage: "/contact/",
      name: "Priya Shah", postcode: "SW19 3DN", service: "planting", createdAt: new Date(Date.now() - 8 * day) },
    // Came from the reveal video on Instagram, converted later from a Google search (first vs last touch).
    { id: "fx_lead_4", tenantId: T, source: "instagram", medium: "paid_social", campaign: "putney-reveal", content: "asset_fx_video",
      landingPage: "/projects/sandstone-circle-patio-brick-raised-beds-putney", assetId: "fx_video", name: "Ben Walsh", postcode: "SW15 1LT",
      service: "patio_paving", createdAt: ago(2 * day),
      attribution: {
        first: { source: "instagram", medium: "paid_social", campaign: "putney-reveal", content: "asset_fx_video", landingPage: "/projects/sandstone-circle-patio-brick-raised-beds-putney", ts: Date.now() - 6 * day },
        last: { source: "google", medium: "organic", landingPage: "/contact/", referrer: "https://www.google.com/", ts: Date.now() - 2 * day },
      } },
    // Credited to ad copy via last-touch utm_content only.
    { id: "fx_lead_5", tenantId: T, source: "google", medium: "cpc", campaign: "pmax-sw-london", landingPage: "/", name: "Clara Moss",
      postcode: "SW19 7PL", service: "full_design", createdAt: ago(4 * day),
      attribution: {
        first: { source: "google", medium: "cpc", campaign: "pmax-sw-london", landingPage: "/", ts: Date.now() - 5 * day },
        last: { source: "facebook", medium: "paid_social", campaign: "putney-patio-craft", content: "asset_fx_ad_copy", landingPage: "/projects/sandstone-circle-patio-brick-raised-beds-putney", ts: Date.now() - 4 * day },
      } },
  ]);

  console.log(
    `Fixtures: ${n} assets for ${JOB}, crew-only job fx_job_crew (3 blocked drafts), withdrawn testimonial on job_pond, ` +
      `2 flagged + 1 unscreened photo, 4 background tasks, 1 held message, 5 leads${video.fileKey ? ", 1 video" : ""}.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
