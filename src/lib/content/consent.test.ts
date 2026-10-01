import { describe, expect, it } from "vitest";
import { THORBURN_CONFIG } from "@/lib/tenant";
import { decideConsent, GENERIC_AREA, outwardCode, testimonialPermission, type ConsentInput } from "./consent";
import { buildContentContext, publicMedia, thinInputCheck } from "./context";

const base = (t: ConsentInput["testimonial"]): ConsentInput => ({
  job: { area: "Putney", postcode: "SW15 2QT" },
  customer: { firstName: "James", lastName: "Patel" },
  testimonial: t,
  config: THORBURN_CONFIG,
});
const responded = {
  status: "responded" as const,
  rating: 5,
  quote: "Exactly what we pictured.",
  consentPhotos: true,
  consentArea: true,
  consentFirstName: true,
  consentQuote: true as boolean | null,
  withdrawnAt: null as Date | null,
};

describe("decideConsent", () => {
  it("full consent: area, first name and testimonial are usable; surname never", () => {
    const d = decideConsent(base(responded));
    expect(d.publicAllowed).toBe(true);
    expect(d.photoConsent).toBe("given");
    expect(d.area).toEqual({ name: "Putney", named: true, outwardCode: "SW15" });
    expect(d.testimonial).toEqual({ quote: "Exactly what we pictured.", rating: 5, attribution: "James, Putney" });
    expect(d.forbidden.map((f) => f.term)).toEqual(["Patel"]);
    expect(d.notes.filter((n) => !n.ok)).toEqual([]);
  });

  it("refused photos: no public assets at all", () => {
    const d = decideConsent(base({ ...responded, consentPhotos: false }));
    expect(d.publicAllowed).toBe(false);
    expect(d.photoConsent).toBe("refused");
  });

  it("no response yet: generic area, no name, no quote, reviewer warned about photos", () => {
    const d = decideConsent(base({ ...responded, status: "sent", consentPhotos: null, consentArea: null, consentFirstName: null }));
    expect(d.publicAllowed).toBe(true);
    expect(d.photoConsent).toBe("unconfirmed");
    expect(d.area).toEqual({ name: GENERIC_AREA, named: false, outwardCode: null });
    expect(d.testimonial).toBeNull();
    expect(d.forbidden.map((f) => f.term).sort()).toEqual(["James", "Patel", "Putney", "SW15"]);
    expect(d.notes.find((n) => n.id === "consent-photos")?.ok).toBe(false);
  });

  it("no testimonial row at all behaves like no response", () => {
    const d = decideConsent(base(null));
    expect(d.publicAllowed).toBe(true);
    expect(d.testimonial).toBeNull();
    expect(d.area.named).toBe(false);
  });

  it("expired request: generate without testimonial", () => {
    const d = decideConsent(base({ ...responded, status: "expired" }));
    expect(d.testimonial).toBeNull();
    expect(d.firstName).toBeNull();
  });

  it("area consent without first-name consent attributes to 'Homeowner, <area>'", () => {
    const d = decideConsent(base({ ...responded, consentFirstName: false }));
    expect(d.testimonial?.attribution).toBe("Homeowner, Putney");
    expect(d.forbidden.map((f) => f.term)).toContain("James");
  });

  it("first name without area consent uses the generic region", () => {
    const d = decideConsent(base({ ...responded, consentArea: false }));
    expect(d.testimonial?.attribution).toBe(`James, ${GENERIC_AREA}`);
    expect(d.forbidden.map((f) => f.term)).toEqual(expect.arrayContaining(["Putney", "SW15"]));
  });

  it("a 3-star rating is not featured publicly", () => {
    const d = decideConsent(base({ ...responded, rating: 3 }));
    expect(d.testimonial).toBeNull();
    expect(d.notes.find((n) => n.id === "testimonial-withheld")?.message).toMatch(/3\/5/);
  });

  it("quote not consented: photos, area and name still usable, but no quote and no rating", () => {
    for (const consentQuote of [false, null]) {
      const d = decideConsent(base({ ...responded, consentQuote }));
      expect(d.publicAllowed).toBe(true);
      expect(d.photoConsent).toBe("given");
      expect(d.area.named).toBe(true);
      expect(d.firstName).toBe("James");
      expect(d.testimonial).toBeNull();
      expect(d.notes.find((n) => n.id === "testimonial-withheld")).toMatchObject({ ok: true, message: expect.stringMatching(/permission to quote/) });
    }
  });

  it("withdrawn consent: nothing public, like a photo refusal", () => {
    const d = decideConsent(base({ ...responded, withdrawnAt: new Date("2026-09-10") }));
    expect(d.publicAllowed).toBe(false);
    expect(d.refusal).toBe("withdrawn");
    expect(d.testimonial).toBeNull();
    expect(d.area.named).toBe(false);
    expect(decideConsent(base({ ...responded, consentPhotos: false })).refusal).toBe("photos_refused");
  });

  it("testimonialPermission is one permission for words and score", () => {
    expect(testimonialPermission(responded)).toEqual({ ok: true, quote: "Exactly what we pictured.", rating: 5 });
    expect(testimonialPermission({ ...responded, quote: "  Lovely   job.  " })).toMatchObject({ ok: true, quote: "Lovely job." });
    expect(testimonialPermission({ ...responded, consentQuote: false }).ok).toBe(false);
    expect(testimonialPermission({ ...responded, rating: 4 }).ok).toBe(true);
    expect(testimonialPermission({ ...responded, rating: 3 }).ok).toBe(false);
    expect(testimonialPermission({ ...responded, withdrawnAt: new Date() }).ok).toBe(false);
    expect(testimonialPermission({ ...responded, status: "sent" })).toEqual({ ok: false, reason: null });
    expect(testimonialPermission(null)).toEqual({ ok: false, reason: null });
  });

  it("a testimonial without a quote or rating is not used", () => {
    expect(decideConsent(base({ ...responded, quote: "  " })).testimonial).toBeNull();
    expect(decideConsent(base({ ...responded, rating: null })).testimonial).toBeNull();
  });

  it("derives the area from the postcode when the job has none", () => {
    const d = decideConsent({ ...base(responded), job: { area: null, postcode: "SW197AB" } });
    expect(d.area).toEqual({ name: "Wimbledon", named: true, outwardCode: "SW19" });
  });

  it("outwardCode parses spaced, compact and outward-only postcodes", () => {
    expect(outwardCode("sw15 2qt")).toBe("SW15");
    expect(outwardCode("TW106AA")).toBe("TW10");
    expect(outwardCode("SW4")).toBe("SW4");
    expect(outwardCode("not a postcode")).toBeNull();
  });
});

describe("content context", () => {
  const img = (id: string, stage: "before" | "after", extra: Partial<Parameters<typeof publicMedia>[0][number]> = {}) => ({
    id, stage, kind: "image" as const, publicKey: `k/${id}.jpg`, blurredKey: null, privacyClearedAt: null,
    isHero: false, qualityScore: 0.9, qualityNotes: null as string | null, ...extra,
  });
  const media = [
    img("a", "after"),
    img("b", "before", { isHero: true, qualityScore: 0.8 }),
    // A separate EXIF-stripped copy (publicKey !== storageKey) is NOT a blurred copy: still withheld.
    img("blur", "after", { qualityNotes: "needs blur: faces visible" }),
    img("dark", "after", { qualityScore: 0.2, qualityNotes: "too dark" }),
    img("private", "after", { publicKey: null, qualityScore: null }),
    img("unscreened", "after", { qualityNotes: "needs blur: not privacy-screened" }),
    { ...img("voice", "after", { publicKey: null, qualityScore: null }), kind: "audio" as const },
  ];

  it("publicMedia excludes blur-pending, unscreened, low-quality and private-only images", () => {
    const { usable, excluded } = publicMedia(media);
    expect(usable.map((m) => m.id)).toEqual(["a", "b"]);
    expect(excluded).toEqual(["blur", "dark", "private", "unscreened"]);
  });

  it("publicMedia uses the blurred copy, or the public copy once the operator cleared it", () => {
    const { usable } = publicMedia([
      img("blurred", "after", { qualityNotes: "needs blur: number plate visible", blurredKey: "k/blurred.blur.jpg" }),
      img("cleared", "after", { qualityNotes: "needs blur: people visible", privacyClearedAt: new Date() }),
    ]);
    expect(usable.map((m) => [m.id, m.publicKey])).toEqual([
      ["blurred", "k/blurred.blur.jpg"],
      ["cleared", "k/cleared.jpg"],
    ]);
  });

  it("flags thin input for the reviewer", () => {
    expect(thinInputCheck("  ", { features: [], materials: [], scope: [] })).toMatchObject({ id: "thin-input", ok: false, message: expect.stringMatching(/Add crew notes/) });
    expect(thinInputCheck("Tidied up.", { features: [], materials: [], scope: [] })?.ok).toBe(false);
    expect(thinInputCheck("Laid a patio.", { features: ["patio"], materials: [], scope: [] })).toBeNull();
  });

  it("never passes the private area to copywriters when it is not consented", () => {
    const consent = decideConsent(base(null));
    const ctx = buildContentContext({
      job: { id: "j", code: "TL-1", service: "patio_paving", completedAt: new Date("2026-05-01"), createdAt: new Date("2026-04-01") },
      enrichment: null,
      media,
      crewNotes: "Indian sandstone patio with a red brick band. Two weeks.",
      consent,
      config: THORBURN_CONFIG,
    });
    expect(JSON.stringify(ctx)).not.toMatch(/Putney|SW15|James|Patel/);
    expect(ctx.heroAfterId).toBe("a");
    expect(ctx.heroBeforeId).toBe("b");
    expect(ctx.facts.materials).toEqual(["Indian sandstone", "red brick"]);
    expect(ctx.job.year).toBe(2026);
    expect(ctx.notes.map((n) => n.id)).toEqual(expect.arrayContaining(["consent-photos", "media-excluded"]));
  });
});
