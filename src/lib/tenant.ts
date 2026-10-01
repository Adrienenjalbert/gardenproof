/**
 * Tenant (client business) configuration. Phase 1 ships one tenant: Thorburn Landscapes.
 * Stored in tenants.config (jsonb); this file holds the type and the Thorburn default.
 */
export type ServiceDef = { key: string; label: string; subServices: string[]; highTicket: boolean };

export type TenantConfig = {
  name: string;
  website: string;
  phone: string | null;
  wordpress: { baseUrl: string; projectsPath: string } | null;
  brand: {
    primary: string; // olive green used on end cards
    primaryDark: string;
    accent: string;
    text: string;
    logoPath: string; // public path
    displayFont: string;
    bodyFont: string;
  };
  proof: {
    whichRating: string | null; // e.g. "4.9" — confirm current value before ads go live
    whichUrl: string | null;
    googleReviewUrl: string | null;
  };
  services: ServiceDef[];
  /** Outward postcode prefix -> neighbourhood name used in public copy (never the exact address). */
  areas: Record<string, string>;
  cta: { text: string; url: string };
  voice: {
    summary: string;
    doSay: string[];
    dontSay: string[]; // banned phrases (generic AI copy, over-claims)
  };
};

export const THORBURN_CONFIG: TenantConfig = {
  name: "Thorburn Landscapes",
  website: "https://www.thorburnlandscapes.co.uk",
  phone: null,
  wordpress: { baseUrl: "https://www.thorburnlandscapes.co.uk", projectsPath: "/projects/" },
  brand: {
    primary: "#464A33",
    primaryDark: "#2F3222",
    accent: "#B7C24A",
    text: "#FFFFFF",
    logoPath: "/thorburn-logo.jpg",
    displayFont: "Arvo",
    bodyFont: "Nunito Sans",
  },
  proof: {
    whichRating: "4.9",
    whichUrl: null,
    googleReviewUrl: null,
  },
  services: [
    { key: "full_design", label: "Garden design & build", subServices: ["design", "full landscaping"], highTicket: true },
    { key: "patio_paving", label: "Patios & paving", subServices: ["porcelain", "sandstone", "brick edging"], highTicket: true },
    { key: "fencing", label: "Fencing & screening", subServices: ["closeboard", "slatted", "trellis"], highTicket: true },
    { key: "lawn_turf", label: "Lawns & turfing", subServices: ["new turf", "lawn restoration"], highTicket: false },
    { key: "planting", label: "Planting schemes", subServices: ["borders", "pleached trees", "hedging"], highTicket: true },
    { key: "structures", label: "Garden structures", subServices: ["pergola", "raised beds", "garden room base", "water feature"], highTicket: true },
    { key: "maintenance", label: "Garden maintenance", subServices: ["seasonal tidy", "hedge cutting", "lawn care"], highTicket: false },
  ],
  areas: {
    SW19: "Wimbledon",
    SW20: "Raynes Park",
    SW18: "Wandsworth",
    SW17: "Tooting",
    SW15: "Putney",
    SW14: "East Sheen",
    SW13: "Barnes",
    SW12: "Balham",
    SW11: "Battersea",
    SW4: "Clapham",
    TW9: "Richmond",
    TW10: "Richmond",
    KT1: "Kingston",
    KT2: "Kingston",
    KT3: "New Malden",
    SM4: "Morden",
  },
  cta: { text: "Book a design consultation", url: "https://www.thorburnlandscapes.co.uk/contact/" },
  voice: {
    summary:
      "Premium, calm, specific. Talk like a skilled garden craftsman showing a finished job to a neighbour: real materials, real places, real results. British English.",
    doSay: [
      "name the materials and plants",
      "name the neighbourhood (never the street)",
      "describe the before honestly",
      "one clear call to action",
    ],
    dontSay: [
      "transform your outdoor space",
      "oasis",
      "nestled",
      "look no further",
      "elevate",
      "unleash",
      "dream garden",
      "best in London",
      "cheap",
      "!!",
    ],
  },
};

/** Map a UK postcode to the public neighbourhood name, or null. */
export function areaFromPostcode(postcode: string | null | undefined, config: TenantConfig): string | null {
  if (!postcode) return null;
  const outward = postcode.toUpperCase().replace(/\s+/g, " ").trim().split(" ")[0];
  if (!outward) return null;
  if (config.areas[outward]) return config.areas[outward];
  // Accept full postcodes without a space, e.g. "SW197AB"
  const m = postcode.toUpperCase().replace(/\s+/g, "").match(/^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/);
  if (m && config.areas[m[1]]) return config.areas[m[1]];
  return null;
}

export function serviceLabel(key: string, config: TenantConfig): string {
  return config.services.find((s) => s.key === key)?.label ?? key;
}
