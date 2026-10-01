/**
 * Sample asset content for the publishing module, built only from the real seed data (scripts/seed.ts):
 * job_patio (Putney: Indian sandstone circle patio, red brick band, curved brick raised beds, striped lawn,
 * timber pergola, ~2.5 weeks, James P. 5★) and job_pond (Wimbledon: gravel terrace, brick-edged pond).
 * Used by unit tests and by tests/fixtures/insert-mod-d-sample.ts for visual checks.
 */
import type {
  AdCopyContent,
  GbpPostContent,
  PortfolioPageContent,
  SeoArticleContent,
  SocialPackContent,
  VideoAssetContent,
} from "@/lib/domain";
import { THORBURN_CONFIG } from "@/lib/tenant";

export const patioPage: PortfolioPageContent = {
  slug: "indian-sandstone-circle-patio-putney",
  seoTitle: "Indian sandstone circle patio & brick raised beds, Putney",
  metaDescription:
    "A circle-pattern Indian sandstone patio with a red brick band, two curved brick raised beds, a striped lawn and a timber pergola in Putney.",
  h1: "A sandstone circle patio with curved brick raised beds in Putney",
  summary:
    "Thorburn Landscapes laid an Indian sandstone patio in a circle pattern, banded in red brick, for a family garden in Putney. Two curved brick raised beds frame the terrace, with a newly striped lawn and a timber pergola beyond. The work took about two and a half weeks.",
  sections: {
    brief:
      "The homeowners wanted a proper terrace to sit out on, with planting close to the house and a lawn they could enjoy from it.",
    challenge:
      "The patio, raised beds, lawn and pergola had to read as one garden, and the brick beds had to curve with the circle of the paving rather than sit square to it.",
    solution:
      "We laid Indian sandstone in a circle pattern with a band of red brick, built two curved brick raised beds that follow the line of the circle and planted them up, laid a new lawn with a striped finish, and put up a timber pergola.",
    result:
      "A terrace that flows straight onto the lawn, softened by planting at seat height. In the homeowner's words, they now use the garden every evening.",
  },
  facts: {
    service: "Patios & paving",
    area: "Putney",
    materials: ["Indian sandstone", "Red brick", "Timber"],
    features: ["Circle-pattern patio with brick band", "Two curved brick raised beds", "Striped lawn", "Timber pergola"],
    duration: "About 2½ weeks",
  },
  testimonial: {
    quote:
      "Stephen's team were tidy, on time and the patio is exactly what we pictured. We use the garden every evening now.",
    attribution: "James P., Putney",
    rating: 5,
  },
  gallery: [
    {
      mediaId: "med_patio_a1",
      stage: "after",
      alt: "Circular Indian sandstone patio with a red brick band, curved brick raised beds and a striped lawn beyond",
    },
  ],
  beforeAfter: null,
  faqs: [
    {
      q: "What stone was used for the patio?",
      a: "Indian sandstone, laid in a circle pattern and finished with a band of red brick.",
    },
    { q: "How long did the project take?", a: "About two and a half weeks from start to finish." },
    {
      q: "Were the raised beds built on site?",
      a: "Yes. Both beds are curved brick, built to follow the circle of the patio, and were planted up as part of the job.",
    },
  ],
  cta: THORBURN_CONFIG.cta,
  internalLinks: [
    { text: "More patio projects", url: "/portfolio?service=Patios+%26+paving" },
    { text: "All projects", url: "/portfolio" },
  ],
};

export const pondPage: PortfolioPageContent = {
  slug: "pond-gravel-garden-wimbledon",
  seoTitle: "Brick-edged pond & gravel garden, Wimbledon",
  metaDescription:
    "An overgrown Wimbledon garden cleared and rebuilt with a self-binding gravel terrace, a circular brick-edged pond with a solar fountain and a new lawn.",
  h1: "From overgrown to a gravel garden with a round brick pond in Wimbledon",
  summary:
    "An overgrown back garden in Wimbledon, cleared and rebuilt around a self-binding gravel terrace with a circular brick-edged pond and solar fountain. A new lawn runs to the house, the borders were cleaned up and the mature trees kept.",
  sections: {
    brief: "Turn a garden lost to long grass, an old pergola and stored junk into somewhere to sit out again.",
    challenge: "Knee-high grass, a failing pergola and years of stored items, with mature trees worth keeping.",
    solution:
      "We cleared the site, laid a self-binding gravel terrace, built a circular brick-edged pond with a solar fountain, laid a new lawn and tidied the borders around the existing trees.",
    result: "A calm, usable garden with water at its centre, finished in about three weeks.",
  },
  facts: {
    service: "Garden design & build",
    area: "Wimbledon",
    materials: ["Self-binding gravel", "Brick"],
    features: ["Circular brick-edged pond", "Solar fountain", "New lawn", "Mature trees kept"],
    duration: "About 3 weeks",
  },
  testimonial: null,
  gallery: [
    { mediaId: "med_pond_b1", stage: "before", alt: "Overgrown garden with long grass, an old pergola and stored items" },
    { mediaId: "med_pond_a1", stage: "after", alt: "Gravel terrace with a circular brick-edged pond and fountain, lawn and house beyond" },
  ],
  beforeAfter: { beforeMediaId: "med_pond_b1", afterMediaId: "med_pond_a1" },
  faqs: [{ q: "Were the trees kept?", a: "Yes, the mature trees were kept and the borders around them cleaned up." }],
  cta: THORBURN_CONFIG.cta,
  internalLinks: [{ text: "All projects", url: "/portfolio" }],
};

export const patioArticle: SeoArticleContent = {
  slug: "indian-sandstone-patio-ideas-putney",
  seoTitle: "Indian sandstone patios: what to know before you build",
  metaDescription: "What we learnt laying a circle-pattern Indian sandstone patio with brick raised beds in Putney.",
  h1: "Indian sandstone patios: what to know before you build",
  targetKeyword: "indian sandstone patio putney",
  bodyMarkdown: [
    "Indian sandstone is one of the most popular patio stones in **south-west London** gardens.",
    "",
    "## Laying patterns",
    "",
    "A *circle pattern* makes a terrace feel like a room. On our [Putney project](/portfolio) we finished it with:",
    "",
    "- a band of red brick",
    "- two curved brick raised beds",
    "",
    "> We use the garden every evening now.",
  ].join("\n"),
  relatedJobIds: ["job_patio"],
  faqs: [{ q: "Does sandstone need sealing?", a: "Ask us at your consultation — it depends on the stone and how the terrace is used." }],
};

export const patioAds: AdCopyContent = {
  meta: {
    hooks: ["Before you pave, see this", "Sandstone, brick, lawn", "Putney, finished"],
    primaryTexts: [
      "A circle-pattern Indian sandstone patio with a red brick band and curved brick raised beds, finished in Putney.",
      "Two and a half weeks, one terrace the family now uses every evening. Real work by Thorburn Landscapes.",
      "Sandstone patio, brick raised beds, striped lawn and a timber pergola in Putney.",
    ],
    headlines: ["Sandstone patio, Putney", "See the finished garden", "Book a design consultation"],
  },
  pmax: {
    headlines: ["Sandstone Patios Putney", "Curved Brick Raised Beds", "Book a Design Consultation"],
    longHeadlines: ["A circle-pattern Indian sandstone patio with curved brick raised beds in Putney"],
    descriptions: [
      "Sandstone patio, brick beds and a timber pergola.",
      "Real finished gardens in south-west London. Book a design consultation.",
    ],
  },
  angle: "craft",
};

export const patioVideo: VideoAssetContent = {
  template: "reveal",
  ratio: "9:16",
  hook: "Before you pave, see this",
  props: {},
  durationSec: 15,
};

export const patioSocial: SocialPackContent = {
  carouselOrder: ["med_patio_a1"],
  captions: ["Indian sandstone in a circle pattern, banded in red brick. Putney, finished."],
  hashtags: ["putneygardens", "#indiansandstone"],
  reelCoverText: "Putney patio",
};

export const patioGbp: GbpPostContent = {
  text: "Just finished in Putney: an Indian sandstone circle patio with curved brick raised beds and a timber pergola.",
  mediaId: "med_patio_a1",
  ctaType: "BOOK",
  ctaUrl: THORBURN_CONFIG.cta.url,
};
