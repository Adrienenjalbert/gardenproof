/**
 * Offline stand-in for the onboarding pipeline, used only when the live website reader isn't available (no
 * /api/onboarding yet, or no network). Facts are the ones already verified by hand for Thorburn (docs/BUILD_BRIEF_V2.md);
 * nothing is invented: no review quotes, unknown ratings stay null, and project photos are Thorburn's own demo
 * stills from public/demo. The UI labels this as sample data.
 */
import type { BusinessProfile } from "@/lib/intel/types";

const SITE = "https://thorburnlandscapes.co.uk";

export const THORBURN_FIXTURE: BusinessProfile = {
  version: 1,
  source: { url: SITE, scrapedAt: "2026-09-24T09:00:00.000Z" },
  name: "Thorburn Landscapes",
  legalName: "Thorburn Landscapes Ltd",
  companyNumber: "09013186",
  yearsTrading: null,
  tagline: null,
  about: null,
  contact: {
    phone: "020 8064 1303",
    email: "info@thorburnlandscapes.co.uk",
    address: "Wimbledon, London",
    postcode: "SW19 3NW",
  },
  brand: {
    colors: { primary: "#2A7D2E", secondary: "#F1D2A9", accent: "#0B3D2C", background: "#FFFFFF", text: "#222222" },
    fonts: { heading: "Montserrat", body: "Roboto" },
    logoUrl: `${SITE}/wp-content/uploads/2014/09/logo-header1.png`,
    logoKey: null,
    faviconUrl: null,
    buttonRadius: null,
  },
  shell: { headerHtml: "", footerHtml: "", css: "", navLinks: [], screenshotKey: null },
  services: [
    { key: "full_design", label: "Garden design & build", url: `${SITE}/service/` },
    { key: "patio_paving", label: "Patios & paving", url: null },
    { key: "fencing", label: "Fencing & screening", url: null },
    { key: "lawn_turf", label: "Lawns & turfing", url: null },
    { key: "planting", label: "Planting schemes", url: null },
    { key: "structures", label: "Garden structures", url: null },
    { key: "maintenance", label: "Garden maintenance", url: null },
  ],
  areas: [
    { name: "Wimbledon", outward: "SW19" },
    { name: "Putney", outward: "SW15" },
    { name: "Clapham", outward: "SW4" },
    { name: "Richmond", outward: "TW9" },
    { name: "Wandsworth", outward: "SW18" },
    { name: "Barnes", outward: "SW13" },
    { name: "Raynes Park", outward: "SW20" },
  ],
  cta: { text: "Get a quote", url: `${SITE}/contact/` },
  badges: [
    {
      body: "which",
      name: "Which? Trusted Trader",
      verified: true,
      status: "verified",
      profileUrl: "https://trustedtraders.which.co.uk/businesses/thorburn-landscapes-ltd/",
      evidence: [
        {
          url: "https://trustedtraders.which.co.uk/businesses/thorburn-landscapes-ltd/",
          note: "Listed as Thorburn Landscapes Ltd, SW19",
        },
      ],
      imageUrl: null,
      imageKey: null,
      rating: 5,
      reviewCount: 9,
    },
    {
      body: "trustmark",
      name: "TrustMark (APL)",
      verified: true,
      status: "verified",
      profileUrl:
        "https://www.trustmark.org.uk/firms/Thorburn%20Landscapes-999505-SW19%203NW?id=80d35511-7f0d-43b9-b8ee-f460b934a09d",
      evidence: [
        {
          url: "https://www.trustmark.org.uk/firms/Thorburn%20Landscapes-999505-SW19%203NW?id=80d35511-7f0d-43b9-b8ee-f460b934a09d",
          note: "Name and postcode SW19 3NW match",
        },
      ],
      imageUrl: null,
      imageKey: null,
      rating: null,
      reviewCount: null,
    },
    {
      body: "checkatrade",
      name: "Checkatrade",
      verified: false,
      status: "claimed",
      profileUrl: "https://www.checkatrade.com/trades/thorburnlandscapesltd",
      evidence: [
        {
          url: "https://www.checkatrade.com/trades/thorburnlandscapesltd",
          note: "Profile found, but we couldn't match the postcode or phone",
        },
      ],
      imageUrl: null,
      imageKey: null,
      rating: null,
      reviewCount: null,
    },
  ],
  reviews: {
    sources: [
      {
        provider: "which",
        url: "https://trustedtraders.which.co.uk/businesses/thorburn-landscapes-ltd/",
        rating: 5,
        count: 9,
        matched: { by: ["name", "postcode"], confidence: 0.95 },
      },
      {
        provider: "checkatrade",
        url: "https://www.checkatrade.com/trades/thorburnlandscapesltd",
        rating: null,
        count: null,
        matched: { by: ["name"], confidence: 0.6 },
      },
    ],
    featured: [],
    aggregate: { rating: 5, count: 9 },
  },
  projects: [
    {
      title: "Pond & gravel garden, Wimbledon",
      url: `${SITE}/portfolio/`,
      category: "Garden design & build",
      area: "Wimbledon",
      summary: null,
      images: [
        {
          url: "/demo/pond-garden-after.jpg",
          key: null,
          alt: "Circular pond in a gravel garden",
          width: 720,
          height: 720,
        },
      ],
    },
    {
      title: "Sandstone patio & raised beds, Putney",
      url: `${SITE}/portfolio/`,
      category: "Patios & paving",
      area: "Putney",
      summary: null,
      images: [
        {
          url: "/demo/sandstone-patio-after.jpg",
          key: null,
          alt: "Sandstone patio with brick raised beds",
          width: 1280,
          height: 720,
        },
      ],
    },
    {
      title: "Garden room & lawn, Clapham",
      url: `${SITE}/portfolio/`,
      category: "Garden structures",
      area: "Clapham",
      summary: null,
      images: [
        { url: "/demo/garden-room-after.jpg", key: null, alt: "Garden room with new lawn", width: 1280, height: 720 },
      ],
    },
    {
      title: "Garden clearance, Wimbledon",
      url: `${SITE}/portfolio/`,
      category: "Garden design & build",
      area: "Wimbledon",
      summary: null,
      images: [
        {
          url: "/demo/pond-garden-before.jpg",
          key: null,
          alt: "Overgrown garden before work",
          width: 720,
          height: 720,
        },
      ],
    },
  ],
  social: [{ network: "instagram", url: "https://www.instagram.com/thorburn.landscapes/" }],
  warnings: ["“Thorburn Garden Services” in Duns (Scotland) is a different business and was left out."],
  rejected: [
    { url: "https://www.facebook.com/", reason: "Thorburn Garden Services, Duns — different business (Scotland)" },
  ],
};
