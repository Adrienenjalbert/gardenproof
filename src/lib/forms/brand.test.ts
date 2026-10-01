import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { seedTenant, T } from "@/lib/bot/test-fixtures";
import type { BusinessProfile } from "@/lib/intel/types";
import { inkOn, projectLabel, resolveBrand, shortQuote } from "./brand";

beforeAll(() => seedTenant(), 120_000);

/** Keys point at real files under public/ (only local copies are ever shown). */
const img = (url: string, key: string | null, alt: string | null = null) => ({ url, key, alt, width: 1600, height: 1200 });

const profile: BusinessProfile = {
  version: 1,
  source: { url: "https://thorburnlandscapes.co.uk", scrapedAt: "2026-09-24" },
  name: "Thorburn Landscapes",
  legalName: null,
  companyNumber: null,
  yearsTrading: null,
  tagline: null,
  about: null,
  contact: { phone: "020 8064 1303", email: null, address: null, postcode: "SW19 3NW" },
  brand: {
    colors: { primary: "#2A7D2E", secondary: "#F1D2A9", accent: null, background: "#FFFFFF", text: "#0B3D2C" },
    fonts: { heading: null, body: null },
    logoUrl: "https://thorburnlandscapes.co.uk/logo.png",
    logoKey: "thorburn-logo.jpg",
    faviconUrl: null,
    buttonRadius: null,
  },
  shell: { headerHtml: "", footerHtml: "", css: "", navLinks: [], screenshotKey: null },
  services: [],
  areas: [{ name: "Streatham", outward: "SW16" }],
  cta: { text: "Contact", url: "https://thorburnlandscapes.co.uk/contact/" },
  badges: [],
  reviews: {
    sources: [],
    featured: [{ provider: "which", author: "Customer in Greater London", text: "They re-turfed the lawn and rebuilt the borders; tidy, punctual and lovely to deal with.", rating: 5, date: null, url: "https://which.co.uk" }],
    aggregate: { rating: 5, count: 55 },
  },
  projects: [
    {
      title: "Garden Renovation in Wimbledon: Full Garden Design",
      url: "https://x/1",
      category: "Landscaping & Garden Design",
      area: "Wimbledon",
      summary: null,
      images: [img("https://x/Before-2.jpg", "demo/pond-garden-before.jpg", "User comments"), img("https://x/After-10.jpg", "demo/pond-garden-after.jpg", "After (10)")],
    },
    { title: "Patio in Putney", url: "https://x/2", category: "Patios", area: "Putney", summary: null, images: [img("https://x/Before-9.jpg", "demo/pond-garden-before.jpg"), img("https://x/Before-10.jpg", null)] },
    { title: "Kingston Garden Update: Entertainment Garden", url: "https://x/3", category: "Landscaping & Garden Design", area: "Coombe Rise/ Kingston", summary: null, images: [img("https://x/IMG_1.jpg", "demo/garden-room-after.jpg"), img("https://x/IMG_2.jpg", "intel/missing.jpg")] },
    { title: "Garden maintenance", url: "https://x/4", category: "Garden maintenance", area: null, summary: null, images: [img("https://x/Maintenance-6-1.jpg", "thorburn-logo.jpg")] },
  ],
  social: [],
  warnings: [],
  rejected: [],
};

describe("resolveBrand", () => {
  it("wears the business's own colours, logo, phone and review", async () => {
    const db = await getDb();
    const [tenant] = await db.select().from(schema.tenants);
    const { brand } = await resolveBrand({ ...tenant, id: T, profile });
    expect(brand).toMatchObject({
      primary: "#2A7D2E",
      primaryInk: "#ffffff",
      phone: "020 8064 1303",
      logoUrl: "/thorburn-logo.jpg",
      ownerFirstName: "Stephen",
      heroImage: "/demo/pond-garden-after.jpg",
      rating: { value: 5, count: 55 },
      review: { provider: "which", author: "Customer in Greater London" },
    });
  });

  it("never uses a 'before' photo, keeps maintenance out of the style cards and labels projects briefly", async () => {
    const db = await getDb();
    const [tenant] = await db.select().from(schema.tenants);
    const { context } = await resolveBrand({ ...tenant, profile });
    const images = [...context.styles.map((s) => s.image), ...context.services.map((s) => s.image)].filter(Boolean);
    expect(images.some((u) => /before/i.test(u!))).toBe(false);
    expect(images.every((u) => u!.startsWith("/"))).toBe(true); // local copies only, never hot-linked
    expect(context.styles.map((s) => [s.label, s.hint])).toEqual([
      ["Garden Renovation", "Wimbledon"],
      ["Kingston Garden Update", "Coombe Rise"],
    ]);
    expect(context.services.find((s) => s.key === "maintenance")?.image).toBe("/thorburn-logo.jpg");
  });

  it("falls back to the config look with no profile", async () => {
    const db = await getDb();
    const [tenant] = await db.select().from(schema.tenants);
    const { brand, context } = await resolveBrand({ ...tenant, slug: "not-the-demo", name: "Acme Gardens", profile: null });
    expect(brand.primary).toBe("#464A33");
    expect(context.styles).toEqual([]); // Thorburn's demo photos are never shown for another business
    expect(context.services.every((s) => s.image === null)).toBe(true);
  });
});

describe("helpers", () => {
  it("shortens project titles to a card label and an area hint", () => {
    expect(projectLabel("Courtyard Garden Renovation in Clapham/Battersea: Full Garden Design", "Clapham / Battersea")).toEqual({ label: "Courtyard Garden Renovation", hint: "Clapham" });
    expect(projectLabel("Garden Design Wimbledon", "Wimbledon")).toEqual({ label: "Garden Design", hint: "Wimbledon" });
  });

  it("quotes whole sentences", () => {
    const long = "Great job on the lawn. The borders look wonderful and the team were tidy every single day of the project. Firstly, I'm really pleased with how it turned out overall and would recommend.";
    expect(shortQuote(long)).toBe("Great job on the lawn. The borders look wonderful and the team were tidy every single day of the project.");
    expect(shortQuote("Short and sweet.")).toBe("Short and sweet.");
  });

  it("picks readable text on the brand colour", () => {
    expect(inkOn("#2A7D2E")).toBe("#ffffff");
    expect(inkOn("#F1D2A9")).toBe("#16180f");
  });
});
