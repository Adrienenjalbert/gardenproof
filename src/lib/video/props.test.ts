import { describe, expect, it } from "vitest";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { durationSeconds, processTimeline, proofTimeline, revealTimeline } from "../../../video/timing";
import {
  buildVideoPlan,
  durationLabel,
  MAX_VIDEO_QUOTE,
  progressLabel,
  serviceLineFor,
  spread,
  stripPlace,
  usableHooks,
  type VideoPlanInput,
} from "./props";
import { resolveRef } from "./refs";

const day = 24 * 3600 * 1000;
const start = new Date("2026-08-01T08:00:00Z");

function photo(id: string, stage: "before" | "progress" | "after", dayOffset: number, extra: Partial<VideoPlanInput["media"][number]> = {}) {
  return {
    id,
    stage,
    kind: "image" as const,
    storageKey: `thorburn/job_x/${id}.jpg`,
    publicKey: `thorburn/job_x/${id}-public.jpg`,
    blurredKey: null as string | null,
    privacyClearedAt: null as Date | null,
    isHero: false,
    qualityScore: 0.5,
    qualityNotes: null as string | null,
    createdAt: new Date(start.getTime() + dayOffset * day),
    ...extra,
  };
}

function input(overrides: Partial<VideoPlanInput> = {}): VideoPlanInput {
  return {
    config: THORBURN_CONFIG,
    job: {
      id: "job_x",
      service: "full_design",
      title: "Pond & gravel garden, Wimbledon",
      area: "Wimbledon",
      postcode: "SW19 5AB",
      startedAt: start,
      completedAt: new Date(start.getTime() + 22 * day),
      enrichment: null,
    },
    media: [photo("b1", "before", 0), photo("a1", "after", 22)],
    testimonial: {
      status: "responded",
      rating: 5,
      quote: "Tidy, on time and exactly what we pictured.",
      consentPhotos: true,
      consentArea: true,
      consentFirstName: true,
      consentQuote: true,
      withdrawnAt: null,
    },
    customerFirstName: "Harriet",
    customerLastName: "Cole",
    adCopy: null,
    ...overrides,
  };
}

const find = (plan: ReturnType<typeof buildVideoPlan>, template: string, ratio: string) =>
  plan.specs.find((s) => s.template === template && s.ratio === ratio);

describe("buildVideoPlan — consent gating", () => {
  it("renders nothing when the homeowner declined photo consent", () => {
    const plan = buildVideoPlan(input({ testimonial: { ...input().testimonial!, consentPhotos: false } }));
    expect(plan.specs).toEqual([]);
    expect(plan.skipped).toMatch(/declined photo consent/);
  });

  it("uses quote, rating, first name and area only with a responded, consented testimonial", () => {
    const p = find(buildVideoPlan(input()), "proof", "9:16")!.props;
    expect(p.quote).toBe("Tidy, on time and exactly what we pictured.");
    expect(p.rating).toBe(5);
    expect(p.areaLine).toBe("Wimbledon");
    expect(p.quoteAttribution).toBe("Harriet, Wimbledon");
  });

  it("hides the area everywhere (incl. service line) without area consent", () => {
    const plan = buildVideoPlan(input({ testimonial: { ...input().testimonial!, consentArea: false } }));
    for (const s of plan.specs) {
      expect(s.props.areaLine).toBeNull();
      expect(s.props.serviceLine).toBe("Pond & gravel garden");
      expect(JSON.stringify(s.props)).not.toMatch(/Wimbledon/);
    }
  });

  it("drops the first name without consent", () => {
    const p = find(buildVideoPlan(input({ testimonial: { ...input().testimonial!, consentFirstName: false } })), "proof", "1:1")!.props;
    expect(p.quoteAttribution).toBe("Homeowner, Wimbledon");
  });

  it("uses no quote, rating or area when the testimonial is still pending", () => {
    const plan = buildVideoPlan(
      input({
        testimonial: { status: "sent", rating: null, quote: null, consentPhotos: null, consentArea: null, consentFirstName: null, consentQuote: null, withdrawnAt: null },
      }),
    );
    const p = find(plan, "reveal", "9:16")!;
    expect(p.props.quote).toBeNull();
    expect(p.props.rating).toBeNull();
    expect(p.props.areaLine).toBeNull();
    expect(p.checks.find((c) => c.id === "consent-photos")).toMatchObject({ ok: false });
  });

  it("never uses a low rating or its quote as proof", () => {
    const plan = buildVideoPlan(input({ testimonial: { ...input().testimonial!, rating: 2, quote: "Late and messy." } }));
    const s = find(plan, "proof", "9:16")!;
    expect(s.props.rating).toBeNull();
    expect(s.props.quote).toBeNull();
    expect(s.checks.find((c) => c.id === "testimonial-withheld")?.message).toMatch(/2\/5/);
  });

  it("no quote consent: no quote AND no stars (one permission), photos still used", () => {
    const plan = buildVideoPlan(input({ testimonial: { ...input().testimonial!, consentQuote: false } }));
    const s = find(plan, "proof", "9:16")!;
    expect(s.props.quote).toBeNull();
    expect(s.props.rating).toBeNull();
    expect(s.props.afterSrc).toBe("storage:thorburn/job_x/a1-public.jpg");
    expect(s.hook).not.toMatch(/5\/5|homeowner’s words/);
    expect(s.checks.find((c) => c.id === "testimonial-withheld")?.message).toMatch(/permission to quote/);
  });

  it("renders nothing once the homeowner has withdrawn consent", () => {
    const plan = buildVideoPlan(input({ testimonial: { ...input().testimonial!, withdrawnAt: new Date() } }));
    expect(plan.specs).toEqual([]);
    expect(plan.skipped).toMatch(/withdrew consent/);
  });

  it("never shortens a quote: a quote too long for the card is left out", () => {
    const quote = `${"Lovely work. ".repeat(20)}`.trim();
    expect(quote.length).toBeGreaterThan(MAX_VIDEO_QUOTE);
    const s = find(buildVideoPlan(input({ testimonial: { ...input().testimonial!, quote } })), "proof", "9:16")!;
    expect(s.props.quote).toBeNull();
    expect(s.props.rating).toBe(5);
    expect(s.checks.find((c) => c.id === "quote-length")?.message).toMatch(/left out rather than shortened/);
  });

  it("privacy-lints on-screen text: an address or surname in the quote is not rendered (P1-5)", () => {
    for (const quote of ["Thank you from us at 14 Ridgway Place, it is perfect.", "The Cole family love it."]) {
      const s = find(buildVideoPlan(input({ testimonial: { ...input().testimonial!, quote } })), "proof", "9:16")!;
      expect(s.props.quote).toBeNull();
      expect(s.props.quoteAttribution).toBeNull();
      expect(JSON.stringify(s.props)).not.toMatch(/Ridgway|Cole/);
      expect(s.checks.find((c) => c.id === "privacy")?.message).toMatch(/Left out of the video: homeowner quote/);
    }
    const clean = find(buildVideoPlan(input()), "proof", "9:16")!;
    expect(clean.checks.find((c) => c.id === "privacy")).toMatchObject({ ok: true, message: expect.stringMatching(/No address/) });
  });

  it("privacy-lints the service line and ad-copy hooks too", () => {
    const job = { ...input().job, title: "New patio at 22 Acacia Road" };
    const s = find(buildVideoPlan(input({ job, adCopy: { hooks: ["Patio at 22 Acacia Road", "Cole garden reveal", "Calm new terrace"], approved: true } })), "reveal", "9:16")!;
    expect(s.props.serviceLine).toBe("Garden design & build");
    expect(s.hook).toBe("Calm new terrace");
    expect(JSON.stringify(s.props)).not.toMatch(/Acacia|Cole/);
  });

  it("does not render without an after photo", () => {
    const plan = buildVideoPlan(input({ media: [photo("b1", "before", 0)] }));
    expect(plan.specs).toEqual([]);
    expect(plan.skipped).toMatch(/No publishable after photo/);
  });
});

describe("buildVideoPlan — formats and fallbacks", () => {
  it("defaults to reveal ×3 and proof 9:16 + 1:1, no process without progress shots", () => {
    const keys = buildVideoPlan(input()).specs.map((s) => `${s.template} ${s.ratio}`);
    expect(keys).toEqual(["reveal 9:16", "reveal 1:1", "reveal 16:9", "proof 9:16", "proof 1:1"]);
  });

  it("adds process when there are progress shots, max 3 spread across the job, labelled by week", () => {
    const media = [
      photo("b1", "before", 0),
      photo("p1", "progress", 2),
      photo("p2", "progress", 6),
      photo("p3", "progress", 9),
      photo("p4", "progress", 15),
      photo("a1", "after", 22),
    ];
    const s = find(buildVideoPlan(input({ media })), "process", "16:9")!;
    expect(s.props.progressSrcs).toEqual([
      "storage:thorburn/job_x/p1-public.jpg",
      "storage:thorburn/job_x/p3-public.jpg",
      "storage:thorburn/job_x/p4-public.jpg",
    ]);
    expect(s.props.progressLabels).toEqual(["Day 3", "Week 2", "Week 3"]);
    expect(s.props.durationLabel).toBe("3 weeks on site");
  });

  it("respects configured formats", () => {
    const plan = buildVideoPlan(input(), { formats: { reveal: ["9:16"], proof: [] } });
    expect(plan.specs.map((s) => `${s.template} ${s.ratio}`)).toEqual(["reveal 9:16"]);
  });

  it("falls back to an after-only reveal with a non before/after hook when there is no before", () => {
    const plan = buildVideoPlan(input({ media: [photo("a1", "after", 22)] }));
    const s = find(plan, "reveal", "9:16")!;
    expect(s.props.beforeSrc).toBeNull();
    expect(s.hook).not.toMatch(/apart/);
    expect(s.checks.some((c) => c.id === "fallback")).toBe(true);
  });

  it("prefers the enrichment / hero after photo, and never falls back to a private original", () => {
    const media = [photo("a1", "after", 20), photo("a2", "after", 21, { isHero: true }), photo("a3", "after", 22, { publicKey: null })];
    expect(find(buildVideoPlan(input({ media })), "proof", "9:16")!.props.afterSrc).toBe("storage:thorburn/job_x/a2-public.jpg");
    const job = { ...input().job, enrichment: { heroAfterMediaId: "a3" } as NonNullable<VideoPlanInput["job"]["enrichment"]> };
    const s = find(buildVideoPlan(input({ media, job })), "proof", "9:16")!;
    expect(s.props.afterSrc).toBe("storage:thorburn/job_x/a2-public.jpg");
    expect(JSON.stringify(buildVideoPlan(input({ media, job })).specs.map((x) => x.props))).not.toMatch(/a3\.jpg/);
    expect(s.checks.find((c) => c.id === "public-derivative")).toMatchObject({ ok: true });
  });

  it("an EXIF-stripped copy is not a blurred copy: flagged photos wait for a blur or an operator clearance (P0-2)", () => {
    // Every photo has publicKey !== storageKey; that alone must NOT count as blurred.
    const flagged = (extra = {}) => photo("a1", "after", 20, { isHero: true, qualityNotes: "needs blur: faces visible", ...extra });
    expect(find(buildVideoPlan(input({ media: [flagged(), photo("a2", "after", 21)] })), "proof", "9:16")!.props.afterSrc).toBe(
      "storage:thorburn/job_x/a2-public.jpg",
    );
    expect(buildVideoPlan(input({ media: [flagged()] })).skipped).toMatch(/No publishable after photo/);
    expect(find(buildVideoPlan(input({ media: [flagged({ blurredKey: "thorburn/job_x/a1.blurred.jpg" })] })), "proof", "9:16")!.props.afterSrc).toBe(
      "storage:thorburn/job_x/a1.blurred.jpg",
    );
    expect(find(buildVideoPlan(input({ media: [flagged({ privacyClearedAt: new Date() })] })), "proof", "9:16")!.props.afterSrc).toBe(
      "storage:thorburn/job_x/a1-public.jpg",
    );
    // Unscreened (enrichment could not assess it) is treated as flagged.
    expect(buildVideoPlan(input({ media: [photo("a1", "after", 20, { qualityNotes: "needs blur: not privacy-screened" })] })).skipped).toMatch(/No publishable/);
  });

  it("titles assets for the dashboard", () => {
    expect(find(buildVideoPlan(input()), "reveal", "9:16")!.title).toBe("Reveal · 9:16 · Pond & gravel garden, Wimbledon");
  });

  it("produces props whose timelines match the brief (≈8s / ≈12s / ≈15s)", () => {
    const media = [photo("b1", "before", 0), photo("p1", "progress", 5), photo("p2", "progress", 10), photo("p3", "progress", 15), photo("a1", "after", 22)];
    const plan = buildVideoPlan(input({ media }));
    const sec = (t: "reveal" | "proof" | "process") => durationSeconds(t, find(plan, t, "9:16")!.props);
    expect(sec("reveal")).toBeGreaterThanOrEqual(7);
    expect(sec("reveal")).toBeLessThanOrEqual(9.5);
    expect(sec("proof")).toBeGreaterThanOrEqual(10);
    expect(sec("proof")).toBeLessThanOrEqual(14);
    expect(sec("process")).toBeGreaterThanOrEqual(13);
    expect(sec("process")).toBeLessThanOrEqual(16);
  });
});

describe("hooks", () => {
  it("uses ad-copy hooks, one per template slot; only approved ad copy makes hook-source ok (QA B8)", () => {
    const hooks = ["From jungle to pond", "Tidy crew, calm garden", "Three weeks of craft"];
    const plan = buildVideoPlan(input({ adCopy: { hooks, approved: true } }));
    expect(find(plan, "reveal", "9:16")!.hook).toBe("From jungle to pond");
    expect(find(plan, "proof", "9:16")!.hook).toBe("Tidy crew, calm garden");
    expect(find(plan, "reveal", "9:16")!.checks.find((c) => c.id === "hook-source")).toMatchObject({ ok: true, message: "Hook from approved ad copy" });
    const draft = find(buildVideoPlan(input({ adCopy: { hooks, approved: false } })), "reveal", "9:16")!;
    expect(draft.checks.find((c) => c.id === "hook-source")).toMatchObject({ ok: false, message: expect.stringMatching(/still in review/) });
    const none = find(buildVideoPlan(input()), "reveal", "9:16")!;
    expect(none.checks.find((c) => c.id === "hook-source")).toMatchObject({ ok: false, message: expect.stringMatching(/Default hook/) });
  });

  it("asks the reviewer to confirm the Which? rating (not a consent check, so approval is not blocked)", () => {
    const c = find(buildVideoPlan(input()), "reveal", "9:16")!.checks.find((x) => x.id === "which-rating")!;
    expect(c).toEqual({ id: "which-rating", ok: false, message: "Confirm the Which? rating (4.9) is current before publishing" });
  });

  it("rejects banned, over-long and non-consented hooks", () => {
    const hooks = [
      "Transform your outdoor space today",
      "A calm new garden in Wimbledon",
      "Harriet's garden before and after",
      "This hook is far far far too long to fit on a phone screen nicely",
      "Pond, gravel, peace",
    ];
    expect(usableHooks(hooks, THORBURN_CONFIG, ["Wimbledon", "Harriet"])).toEqual(["Pond, gravel, peace"]);
  });

  it("defaults to a specific, fact-based hook", () => {
    const plan = buildVideoPlan(input());
    expect(find(plan, "reveal", "9:16")!.hook).toBe("Same garden. Three weeks apart.");
    expect(find(plan, "proof", "9:16")!.hook).toBe("In the homeowner’s words.");
    // No quote means no rating either (one permission), so no "Rated 5/5" hook.
    const noQuote = buildVideoPlan(input({ testimonial: { ...input().testimonial!, quote: null } }));
    expect(find(noQuote, "proof", "9:16")!.hook).toBe("Finished in Wimbledon.");
    const tooLong = buildVideoPlan(input({ testimonial: { ...input().testimonial!, quote: "Lovely work. ".repeat(20).trim() } }));
    expect(find(tooLong, "proof", "9:16")!.hook).toBe("Rated 5/5 by the homeowner.");
    // After-only reveal never promises a quote it does not show.
    const afterOnly = buildVideoPlan(input({ media: [photo("a1", "after", 22)] }));
    expect(find(afterOnly, "reveal", "9:16")!.hook).toBe("Rated 5/5 by the homeowner.");
  });

  it("prefers crew-reported duration over job dates", () => {
    const job = { ...input().job, enrichment: { durationDays: 10 } as NonNullable<VideoPlanInput["job"]["enrichment"]> };
    expect(find(buildVideoPlan(input({ job })), "reveal", "9:16")!.hook).toBe("Same garden. One week apart.");
  });
});

describe("helpers", () => {
  it("strips places from titles", () => {
    expect(stripPlace("Pond & gravel garden, Wimbledon", "Wimbledon")).toBe("Pond & gravel garden");
    expect(stripPlace("New patio in Putney", "Putney")).toBe("New patio");
    expect(serviceLineFor({ ...input().job, title: null }, THORBURN_CONFIG)).toBe("Garden design & build");
  });

  it("formats durations and progress labels", () => {
    expect(durationLabel(null)).toBeNull();
    expect(durationLabel(1)).toBe("1 day on site");
    expect(durationLabel(17)).toBe("2 weeks on site");
    expect(progressLabel(new Date(start.getTime() + 3 * day), start)).toBe("Day 4");
    expect(progressLabel(new Date(start.getTime() + 13 * day), start)).toBe("Week 2");
  });

  it("spreads evenly", () => {
    expect(spread([1, 2, 3, 4, 5], 3)).toEqual([1, 3, 5]);
    expect(spread([1, 2], 3)).toEqual([1, 2]);
  });

  it("resolves media refs to the render server", () => {
    expect(resolveRef("storage:thorburn/job 1/a.jpg", "http://127.0.0.1:1")).toBe("http://127.0.0.1:1/storage/thorburn/job%201/a.jpg");
    expect(resolveRef("public:thorburn-logo.jpg", "http://h")).toBe("http://h/public/thorburn-logo.jpg");
    expect(resolveRef("https://x/y.jpg", "http://h")).toBe("https://x/y.jpg");
  });
});

describe("timelines", () => {
  const props = buildVideoPlan(input()).specs[0]!.props;
  it("reveal hooks in the first second and wipes when there is a before", () => {
    const tl = revealTimeline(props);
    expect(tl.mode).toBe("wipe");
    expect(tl.hook.from).toBe(0);
    expect(revealTimeline({ ...props, beforeSrc: null }).mode).toBe("hero");
  });
  it("proof skips the quote section without a quote", () => {
    expect(proofTimeline(props).quote).not.toBeNull();
    const tl = proofTimeline({ ...props, quote: null });
    expect(tl.quote).toBeNull();
    expect(tl.stars).not.toBeNull(); // real rating still gets its beat
    expect(proofTimeline({ ...props, quote: null, rating: null }).stars).toBeNull();
  });
  it("process has one step per photo", () => {
    expect(processTimeline({ ...props, progressSrcs: ["x", "y"], progressLabels: ["Week 1", "Week 2"] }).steps.map((s) => s.label)).toEqual([
      "Before",
      "Week 1",
      "Week 2",
      "Finished",
    ]);
  });
});
