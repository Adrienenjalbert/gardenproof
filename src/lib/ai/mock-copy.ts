/**
 * Demo-mode copywriter: deterministic templates that write Thorburn-style copy purely from
 * the consent-filtered ContentContext. It never adds a fact that is not in the context — the
 * variety comes from the crew's own words (scope clauses, materials, duration). No generic
 * workmanship claims ("a pond edge has to sit dead level"): they read as facts about this job.
 * Thin input (no features in the notes) gets shorter copy built from service + area + photos only.
 * The homeowner quote is used whole or not at all: never shortened to fit a field.
 */
import type {
  AdDraft,
  GbpDraft,
  PortfolioDraft,
  SeoDraft,
  SocialDraft,
} from "@/lib/content/drafts";
import { SERVICE_TAGS } from "@/lib/content/lexicon";
import {
  cap,
  fit,
  fitAll,
  fixProperNouns,
  hashtag,
  joinList,
  lowerFirst,
  slugify,
  stripEndPunct,
  withArticle,
} from "@/lib/content/text";
import type { ContentContext, SeoContext } from "@/lib/content/types";

// ---------------------------------------------------------------------------
// Shared phrasing
// ---------------------------------------------------------------------------
type Parts = {
  f1: string;
  rest: string[];
  area: string;
  materials: string[];
  plants: string[];
  duration: string | null;
  hasBefore: boolean;
};

/** Nothing concrete from the crew: write only what service, area and photos support. */
const isThin = (ctx: ContentContext) => ctx.facts.features.length === 0;

function parts(ctx: ContentContext): Parts {
  const feats = ctx.facts.features.length ? ctx.facts.features : [ctx.job.serviceNoun];
  return {
    f1: feats[0],
    rest: feats.slice(1),
    area: ctx.area.name,
    materials: ctx.facts.materials,
    plants: ctx.facts.plants,
    duration: ctx.facts.durationText,
    hasBefore: ctx.media.some((m) => m.stage === "before"),
  };
}

const GERUNDS: [RegExp, string][] = [
  [/^cleared\b/i, "clearing"], [/^laid\b/i, "laying"], [/^built\b/i, "building"], [/^installed\b/i, "installing"],
  [/^added\b/i, "adding"], [/^planted\b/i, "planting"], [/^cleaned up\b/i, "cleaning up"], [/^kept\b/i, "keeping"],
  [/^put in\b/i, "putting in"], [/^fitted\b/i, "fitting"], [/^created\b/i, "creating"], [/^removed\b/i, "removing"],
  [/^replaced\b/i, "replacing"], [/^levelled\b/i, "levelling"], [/^dug\b/i, "digging"], [/^turfed\b/i, "turfing"],
];

/** Regular past tense + object ("mulched everything", "edged the lawn") -> gerund. Adjectives ("raised beds") are left alone. */
const REGULAR_VERB = /^([a-z]+?)(e?)d\s+(?=(?:the|a|an|it|everything|all|up|in|out|back|two|three|four|new|some|both)\b)/i;

/** Crew clause -> list item: "Cleared it all" -> "clearing the whole plot"; "new lawn" -> "a new lawn". */
function scopeItem(clause: string): string {
  const c = fixProperNouns(stripEndPunct(clause));
  const tidy = (x: string) => x.replace(/\bit all\b/i, "the whole plot").replace(/\s+it$/i, " the site");
  for (const [re, g] of GERUNDS) if (re.test(c)) return tidy(c.replace(re, g));
  const m = c.match(REGULAR_VERB);
  if (m) return tidy(c.replace(REGULAR_VERB, (_all, stem: string, e: string) => `${(stem + e).replace(/e$/, "").toLowerCase()}ing `));
  return withArticle(lowerFirst(c));
}

function scopeSentence(ctx: ContentContext, p: Parts): string {
  if (ctx.facts.scope.length) return `The job covered ${joinList(ctx.facts.scope.map(scopeItem))}.`;
  return `The brief centred on ${withArticle(p.f1)}${p.rest.length ? `, with ${joinList(p.rest.slice(0, 3).map(withArticle))}` : ""}.`;
}

/** Crew shorthand "Overgrown back garden, knee-high grass, old pergola" -> grammatical list. */
function beforeList(challenge: string): string {
  return joinList(
    stripEndPunct(challenge)
      .split(/\s*[,;]\s*|\s+and\s+/)
      .filter(Boolean)
      .map((x) => withArticle(lowerFirst(x))),
  );
}

const durationSentence = (p: Parts) => (p.duration ? `${cap(p.duration)} from start to finish.` : "");
const withList = (xs: string[]) => (xs.length ? ` with ${joinList(xs.map(withArticle))}` : "");
const builtBy = (ctx: ContentContext) =>
  ({ full_design: "designed and built", planting: "planted", maintenance: "looked after" })[ctx.job.service] ?? "built";
const gardenIn = (area: string, named: boolean) => (named ? `a ${area} garden` : `a garden in ${area}`);
/** The whole consented quote. `closed` ends the attribution with a full stop when more copy follows. */
const quoteLine = (ctx: ContentContext, closed = false) =>
  ctx.testimonial ? `“${ctx.testimonial.quote}” – ${ctx.testimonial.attribution}${closed ? "." : ""}` : "";
const photoLine = (p: Parts) =>
  p.hasBefore ? "The photos show the garden before work began and once it was finished." : "The photos show the finished garden.";

// ---------------------------------------------------------------------------
// Portfolio page
// ---------------------------------------------------------------------------
export function mockPortfolio(ctx: ContentContext): PortfolioDraft {
  if (isThin(ctx)) return thinPortfolio(ctx);
  const p = parts(ctx);
  const [f2] = p.rest;
  const t = ctx.tenant;
  const h1 = fit([f2 && `${cap(p.f1)} and ${f2} in ${p.area}`, `${cap(p.f1)} in ${p.area}`], 90);
  const seoTitle = fit(
    [
      f2 && `${cap(p.f1)} & ${f2}, ${p.area} | ${t.shortName}`,
      `${cap(p.f1)}, ${p.area} | ${t.name}`,
      `${cap(p.f1)}, ${p.area} | ${t.shortName}`,
      `${cap(p.f1)} | ${t.shortName}`,
    ],
    65,
  );
  const metaDescription = fit(
    [
      `${cap(withArticle(p.f1))}${withList(p.rest.slice(0, 2))} in ${p.area}. ${durationSentence(p)} A ${t.name} project.`,
      `${cap(withArticle(p.f1))}${withList(p.rest.slice(0, 2))} in ${p.area}. ${durationSentence(p)}`,
      `${cap(withArticle(p.f1))}${withList(p.rest.slice(0, 1))} in ${p.area}. A ${t.name} project.`,
    ],
    160,
  );

  const summary = [
    `${cap(withArticle(p.f1))}${withList(p.rest.slice(0, 3))}, ${builtBy(ctx)} by ${t.name} for ${gardenIn(p.area, ctx.area.named)}.`,
    p.plants.length ? `The planting includes ${joinList(p.plants)}.` : "",
    ctx.facts.challenge ? `It replaced ${withArticle(lowerFirst(stripEndPunct(ctx.facts.challenge.split(",")[0])))}.` : "",
    durationSentence(p),
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

  const cleared = ctx.facts.scope.some((s) => /\b(cleared|removed)\b/i.test(s));
  const challenge = ctx.facts.challenge
    ? [`The starting point: ${beforeList(ctx.facts.challenge)}.`, cleared ? "All of it was cleared before the new layout went in." : ""]
    : [p.hasBefore ? "The before photos show the garden as it was when work began." : `The work centred on ${withArticle(p.f1)}.`];

  const solution = [
    `The layout is built around ${withArticle(p.f1)}${withList(p.rest.slice(0, 4))}.`,
    p.materials.length ? `Materials: ${joinList(p.materials)}.` : "",
  ];

  const result = [
    ctx.facts.result ? `${cap(stripEndPunct(ctx.facts.result))}.` : `The finished garden has ${joinList([p.f1, ...p.rest.slice(0, 3)].map(withArticle))}.`,
    durationSentence(p),
    ctx.testimonial ? `The homeowner rated the work ${ctx.testimonial.rating} out of 5.` : "",
  ];

  const faqs: PortfolioDraft["faqs"] = [];
  if (p.duration) faqs.push({ q: `How long did this ${ctx.job.serviceNoun} project take?`, a: `${cap(p.duration)} from start to finish.` });
  if (p.materials.length) faqs.push({ q: "Which materials were used?", a: `${cap(joinList(p.materials))}.` });
  faqs.push(areaFaq(ctx));

  return {
    slug: slugify(`${p.f1} ${ctx.area.named ? p.area : ""} ${ctx.job.year}`),
    seoTitle,
    metaDescription,
    h1,
    summary,
    sections: {
      brief: scopeSentence(ctx, p),
      challenge: challenge.filter(Boolean).join(" "),
      solution: solution.filter(Boolean).join(" "),
      result: result.filter(Boolean).join(" "),
    },
    faqs,
    gallery: galleryOrder(ctx).map((m, i) => ({ mediaId: m.id, ...altFor(m.stage, i, p, ctx.area.named) })),
  };
}

function areaFaq(ctx: ContentContext): PortfolioDraft["faqs"][number] {
  const t = ctx.tenant;
  const area = ctx.area.name;
  const others = t.serviceAreas.filter((a) => a !== area).slice(0, 4);
  return ctx.area.named
    ? { q: `Do you work in ${area}?`, a: `Yes. This garden is in ${area}, and ${t.name} works across South West London, including ${joinList(others.slice(0, 3))}.` }
    : { q: "Which areas do you cover?", a: `South West London, including ${joinList(others)}.` };
}

/** No features from the crew: short, honest page from service, area, photos and duration only. */
function thinPortfolio(ctx: ContentContext): PortfolioDraft {
  const p = parts(ctx);
  const t = ctx.tenant;
  const label = ctx.job.serviceLabel;
  const noun = ctx.job.serviceNoun;
  const faqs: PortfolioDraft["faqs"] = [];
  if (p.duration) faqs.push({ q: `How long did this ${noun} project take?`, a: `${cap(p.duration)} from start to finish.` });
  faqs.push(areaFaq(ctx));
  return {
    slug: slugify(`${noun} ${ctx.area.named ? p.area : ""} ${ctx.job.year}`),
    seoTitle: fit([`${label} in ${p.area} | ${t.shortName}`, `${label}, ${p.area} | ${t.shortName}`, `${label} | ${t.shortName}`], 65),
    metaDescription: fit(
      [
        `${label} in ${p.area} by ${t.name}. ${p.hasBefore ? "See the before and after photos." : "See the finished garden."}`,
        `${label} in ${p.area} by ${t.name}.`,
      ],
      160,
    ),
    h1: `${label} in ${p.area}`,
    summary: [`${label} in ${p.area} by ${t.name}.`, photoLine(p), durationSentence(p)].filter(Boolean).join(" "),
    sections: {
      brief: `${label} in ${p.area}, completed in ${ctx.job.year}.`,
      challenge: p.hasBefore ? "The before photos show the garden as it was when work began." : "",
      solution: `${cap(builtBy(ctx))} by the ${t.name} team.`,
      result: [p.hasBefore ? "The after photos show the finished garden." : "", durationSentence(p), ctx.testimonial ? `The homeowner rated the work ${ctx.testimonial.rating} out of 5.` : ""]
        .filter(Boolean)
        .join(" "),
    },
    faqs,
    gallery: galleryOrder(ctx).map((m, i) => ({ mediaId: m.id, ...thinAlt(m.stage, i, p.area) })),
  };
}

function thinAlt(stage: string, i: number, area: string): { alt: string; caption: string } {
  const where = `in ${area}`;
  if (stage === "before") return { alt: `The garden ${where} before work began`, caption: "Before" };
  if (stage === "progress") return { alt: `Work in progress on the garden ${where}`, caption: "During the build" };
  return { alt: i === 0 ? `The finished garden ${where}` : `Another view of the finished garden ${where}`, caption: "Finished" };
}

export function galleryOrder(ctx: ContentContext) {
  const rank = (m: ContentContext["media"][number]) =>
    m.id === ctx.heroAfterId ? 0 : m.stage === "after" ? 1 : m.stage === "progress" ? 2 : m.id === ctx.heroBeforeId ? 3 : 4;
  return [...ctx.media].sort((a, b) => rank(a) - rank(b));
}

function altFor(stage: string, i: number, p: Parts, named: boolean): { alt: string; caption: string } {
  const where = named ? `in ${p.area}` : `in a ${p.area} garden`;
  if (stage === "before") return { alt: `The garden ${where} before work began`, caption: "Before" };
  if (stage === "progress") return { alt: `Work in progress on the ${p.f1} ${where}`, caption: "During the build" };
  const second = p.rest[0] ? ` with ${withArticle(p.rest[0])}` : "";
  return i === 0
    ? { alt: `Finished ${p.f1}${second} ${where}`, caption: "Finished" }
    : { alt: `Another view of the finished ${p.f1} ${where}`, caption: "Finished" };
}

// ---------------------------------------------------------------------------
// Ad copy (Meta + Google PMax)
// ---------------------------------------------------------------------------
export function mockAdCopy(ctx: ContentContext): AdDraft {
  if (isThin(ctx)) return thinAdCopy(ctx);
  const p = parts(ctx);
  const t = ctx.tenant;
  const noun = ctx.job.serviceNoun;
  const [f2, f3] = p.rest;
  const area = p.area;

  const hooks = fitAll(
    [
      `${cap(noun)} specialist in ${area}?`,
      `Looking for a ${noun} specialist in ${area}?`,
      `Looking for a ${noun} specialist?`,
      `${cap(p.f1)}, ${area}`,
      p.hasBefore && `Before and after in ${area}`,
      p.duration && `Finished in ${p.duration}`,
      `${cap(p.f1)}, finished`,
    ],
    60,
    6,
  ).slice(0, 5);

  const primaryTexts = fitAll(
    [
      `${cap(withArticle(p.f1))}${withList(p.rest.slice(0, 2))}. Finished in ${area}.`,
      `${cap(withArticle(p.f1))}${withList(p.rest.slice(0, 1))}. Finished in ${area}.`,
      quoteLine(ctx), // whole quote or nothing: fitAll drops it when it is over 125 characters
      p.materials.length > 0 && `${cap(joinList(p.materials))}. ${cap(withArticle(p.f1))} in ${area}${p.duration ? `, ${p.duration} start to finish` : ""}.`,
      p.materials.length > 0 && `${cap(joinList(p.materials))}. ${cap(withArticle(p.f1))} in ${area}.`,
      `Planning ${withArticle(noun)} in ${area}? ${t.cta.text}.`,
      t.whichRating && `Rated ${t.whichRating} on Which? Trusted Traders. ${t.cta.text}.`,
    ],
    125,
  ).slice(0, 5);

  const headlines = fitAll(
    [
      `${cap(p.f1)}, ${area}`,
      `${ctx.job.serviceLabel} in ${area}`,
      p.hasBefore && `Before & after: ${area} garden`,
      f2 && `${cap(f2)}, ${area}`,
      cap(p.f1),
      t.cta.text,
      t.name,
    ],
    40,
  ).slice(0, 5);

  const pmaxHeadlines = fitAll(
    [
      `${ctx.job.serviceLabel} in ${area}`,
      ...[p.f1, f2, f3].filter((f): f is string => !!f && f.includes(" ")).map(cap),
      t.cta.text,
      t.name,
      t.whichRating && `Rated ${t.whichRating} on Which?`,
      ctx.job.service === "full_design" && `Garden design in ${area}`,
    ],
    30,
  ).slice(0, 10);

  const longHeadlines = fitAll(
    [
      `${cap(withArticle(p.f1))}${withList(p.rest.slice(0, 1))}, built in ${area}`,
      `${cap(withArticle(p.f1))} in ${area}`,
      `See a finished ${area} garden by ${t.name}`,
    ],
    90,
  ).slice(0, 3);

  const descriptions = fitAll(
    [
      `${cap(joinList([p.f1, ...p.rest.slice(0, 2)]))} in ${area}.`,
      `${cap(joinList([p.f1, ...p.rest.slice(0, 1)]))} in ${area}.`,
      p.materials.length > 0 && `Real work, real materials: ${joinList(p.materials.slice(0, 3))}.`,
      `${t.cta.text} with ${t.name}.`,
      `${t.cta.text}.`,
    ],
    90,
  ).slice(0, 4);

  return {
    meta: { hooks, primaryTexts, headlines },
    pmax: { headlines: pmaxHeadlines, longHeadlines, descriptions },
    angle: ctx.testimonial ? "proof" : p.hasBefore && ctx.facts.challenge ? "transformation" : "craft",
  };
}

/** Thin input: service + area + photos. Still meets every field minimum without inventing detail. */
function thinAdCopy(ctx: ContentContext): AdDraft {
  const p = parts(ctx);
  const t = ctx.tenant;
  const label = ctx.job.serviceLabel;
  const noun = ctx.job.serviceNoun;
  const area = p.area;
  return {
    meta: {
      hooks: fitAll(
        [
          `${cap(noun)} specialist in ${area}?`,
          `Looking for a ${noun} specialist?`,
          p.hasBefore && `Before and after in ${area}`,
          p.hasBefore && "Same garden, before and after",
          `${cap(noun)}, finished`,
          `A finished ${area} garden`,
          `Recently finished: ${noun}`,
        ],
        60,
        6,
      ).slice(0, 5),
      primaryTexts: fitAll(
        [
          `${label} in ${area}, finished by ${t.name}.`,
          p.hasBefore && `Before and after: ${withArticle(noun)} in ${area}.`,
          quoteLine(ctx),
          `Planning ${withArticle(noun)} in ${area}? ${t.cta.text}.`,
          t.whichRating && `Rated ${t.whichRating} on Which? Trusted Traders. ${t.cta.text}.`,
          `${t.cta.text} with ${t.name}.`,
        ],
        125,
      ).slice(0, 5),
      headlines: fitAll([`${label} in ${area}`, `${label}, ${area}`, p.hasBefore && `Before & after: ${area} garden`, t.cta.text, t.name], 40).slice(0, 5),
    },
    pmax: {
      headlines: fitAll(
        [`${label} in ${area}`, `${cap(noun)} in ${area}`, label, t.cta.text, t.name, t.whichRating && `Rated ${t.whichRating} on Which?`],
        30,
      ).slice(0, 10),
      longHeadlines: fitAll([`${label} in ${area} by ${t.name}`, `See a finished ${area} garden by ${t.name}`, `${label} in ${area}`], 90).slice(0, 3),
      descriptions: fitAll([`${label} in ${area}.`, `${t.cta.text} with ${t.name}.`, `${t.cta.text}.`], 90).slice(0, 4),
    },
    angle: ctx.testimonial ? "proof" : p.hasBefore ? "transformation" : "craft",
  };
}

// ---------------------------------------------------------------------------
// Social pack
// ---------------------------------------------------------------------------
export function mockSocial(ctx: ContentContext): SocialDraft {
  const p = parts(ctx);
  const t = ctx.tenant;
  const thin = isThin(ctx);
  const cta = `${t.cta.text} – link in bio.`;
  const story = thin
    ? [`${ctx.job.serviceLabel} in ${p.area}.`, photoLine(p), durationSentence(p), quoteLine(ctx, true), cta]
    : [
        `${cap(p.f1)}${p.rest[0] ? ` and ${p.rest[0]}` : ""} in ${p.area}.`,
        ctx.facts.challenge ? `Before: ${beforeList(ctx.facts.challenge)}.` : "",
        scopeSentence(ctx, p),
        durationSentence(p),
        quoteLine(ctx, true),
        cta,
      ];
  const short = thin
    ? [`${ctx.job.serviceLabel}, finished in ${p.area}.`, cta]
    : [
        p.materials.length ? `${cap(joinList(p.materials))}.` : "",
        `${cap(withArticle(p.f1))}${withList(p.rest.slice(0, 2))}, finished in ${p.area}.`,
        cta,
      ];

  const tags = [
    ctx.area.named ? hashtag(`${p.area} gardens`) : "#LondonGardens",
    ...p.materials.filter((m) => m.includes(" ") || m.includes("-")).slice(0, 2).map((m) => hashtag(m)),
    SERVICE_TAGS[ctx.job.service] ?? "#GardenDesign",
    "#Landscaping",
    "#SouthWestLondon",
    hashtag(t.name),
  ];
  return {
    captions: [story.filter(Boolean).join("\n\n"), short.filter(Boolean).join(" ")],
    hashtags: [...new Set(tags.filter(Boolean))],
    reelCoverText: fit([p.hasBefore && `${p.area}: before & after`, !thin && cap(p.f1), ctx.job.serviceLabel], 40),
  };
}

// ---------------------------------------------------------------------------
// Google Business Profile post
// ---------------------------------------------------------------------------
export const GBP_MAX = 1500;

export function mockGbp(ctx: ContentContext): GbpDraft {
  const p = parts(ctx);
  const t = ctx.tenant;
  const thin = isThin(ctx);
  const cta = `Planning ${withArticle(ctx.job.serviceNoun)}? ${t.cta.text} with ${t.name}.`;
  const body = [
    thin
      ? `Recently finished in ${p.area}: ${ctx.job.serviceLabel.toLowerCase()}. ${photoLine(p)}`
      : `Recently finished in ${p.area}: ${withArticle(p.f1)}${withList(p.rest.slice(0, 3))}.`,
    !thin && ctx.facts.challenge ? `The starting point: ${beforeList(ctx.facts.challenge)}.` : "",
    p.materials.length ? `Materials: ${joinList(p.materials)}. ${durationSentence(p)}`.trim() : durationSentence(p),
  ].filter(Boolean);
  // Whole quote or none: if it would push the post over the limit, leave it out (never cut it).
  const withQuote = [...body, quoteLine(ctx, true), cta].filter(Boolean).join("\n\n");
  return { text: withQuote.length <= GBP_MAX ? withQuote : [...body, cta].join("\n\n") };
}

// ---------------------------------------------------------------------------
// SEO cluster article (service x area)
// ---------------------------------------------------------------------------
export function mockSeoArticle(ctx: SeoContext): SeoDraft {
  const { area, serviceLabel, serviceNoun, pages, tenant } = ctx;
  const materials = [...new Set(pages.flatMap((pg) => pg.materials))];
  const durations = pages.filter((pg) => pg.duration).map((pg) => `${pg.h1}: ${pg.duration}`);

  const body = [
    `${tenant.name} has completed ${pages.length} ${serviceLabel.toLowerCase()} projects in ${area} that are shown in full on our projects page. This guide pulls together what they have in common: the materials, the details and how long the work took.`,
    `## Recent ${serviceLabel.toLowerCase()} projects in ${area}`,
    ...pages.map((pg) => `### [${pg.h1}](${pg.url})\n\n${pg.summary}`),
    `## What was built\n\n${pages.map((pg) => `- **${pg.h1}:** ${joinList(pg.features) || "see the project page"}`).join("\n")}`,
    materials.length ? `## Materials we used in ${area}\n\n${pages.map((pg) => `- **${pg.h1}:** ${joinList(pg.materials) || "see the project page"}`).join("\n")}` : "",
    durations.length ? `## How long does ${withArticle(serviceNoun)} take?\n\nOn these ${area} jobs:\n\n${durations.map((d) => `- ${d}`).join("\n")}` : "",
    `## Planning ${withArticle(serviceNoun)} in ${area}?\n\nEvery project above started with a conversation on site. [${tenant.cta.text}](${tenant.cta.url}).`,
  ].filter(Boolean);

  const faqs: SeoDraft["faqs"] = [
    { q: `Do you take on ${serviceLabel.toLowerCase()} projects in ${area}?`, a: `Yes. ${tenant.name} has completed ${pages.length} ${serviceLabel.toLowerCase()} projects in ${area}, each shown on our projects page.` },
  ];
  if (materials.length) faqs.push({ q: `Which materials have you used on ${serviceLabel.toLowerCase()} projects in ${area}?`, a: `On recent ${area} jobs: ${joinList(materials)}.` });

  return {
    seoTitle: fit([`${serviceLabel} in ${area}: Recent Projects | ${tenant.shortName}`, `${serviceLabel} in ${area} | ${tenant.shortName}`, `${serviceLabel} in ${area}`], 65),
    metaDescription: fit(
      [
        `${pages.length} finished ${serviceLabel.toLowerCase()} projects in ${area} by ${tenant.name}${materials.length ? `, using ${joinList(materials.slice(0, 3))}` : ""}. See the work and how long it took.`,
        `${pages.length} finished ${serviceLabel.toLowerCase()} projects in ${area} by ${tenant.name}.`,
      ],
      160,
    ),
    h1: `${serviceLabel} in ${area}`,
    targetKeyword: `${serviceNoun} ${area}`.toLowerCase(),
    bodyMarkdown: body.join("\n\n"),
    faqs,
  };
}
