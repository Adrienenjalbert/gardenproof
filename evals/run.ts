/**
 * Content eval harness.
 *
 *   npx tsx evals/run.ts            # mock mode unless ANTHROPIC_API_KEY is set
 *   AI_PROVIDER=mock npx tsx evals/run.ts
 *
 * For each golden job it runs enrichment-free generation (facts come from the crew brief only),
 * applies lintAsset and a rubric, and writes evals/report.md + evals/report.json.
 * With a real key it also asks an LLM judge for a "premium feel" score (1-5).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generate, usingMockAI } from "@/lib/ai/client";
import { decideConsent } from "@/lib/content/consent";
import { buildContentContext } from "@/lib/content/context";
import { JudgeSchema } from "@/lib/content/drafts";
import { JOB_ASSET_TYPES, writeJobAsset, type JobAssetType } from "@/lib/content/generate";
import { collectText } from "@/lib/content/lint";
import { slugify } from "@/lib/content/text";
import type { Check } from "@/lib/content/types";
import type { Testimonial } from "@/db/schema";

type GateTestimonial = Pick<
  Testimonial,
  "status" | "rating" | "quote" | "consentPhotos" | "consentArea" | "consentFirstName" | "consentQuote" | "withdrawnAt"
>;
import type { MediaStage } from "@/lib/domain";
import { THORBURN_CONFIG } from "@/lib/tenant";
import golden from "./golden.json";

type GoldenCase = (typeof golden.cases)[number];

export type Criterion = { id: string; ok: boolean; detail: string };
export type CaseReport = {
  id: string;
  scenario: string;
  generated: boolean;
  criteria: Criterion[];
  score: number;
  consentCompliant: boolean;
  premium: number | null;
  assets: Partial<Record<JobAssetType, { content: unknown; checks: Check[] }>>;
};
export type EvalReport = {
  provider: "mock" | "anthropic";
  ranAt: string;
  cases: CaseReport[];
  rubricPassRate: number;
  consentCompliance: number;
  premiumAverage: number | null;
};

/** Lint checks that must pass (reviewer notes such as consent-photos / thin-input are informational here). */
const LINT_IDS = [
  "schema", "banned-phrases", "british-spelling", "exclamations", "grammar", "privacy", "claims", "lengths", "slug", "media-ids",
  "alt-text", "cta", "consent", "quote-verbatim", "repetition", "cta-punctuation",
];

/** Generic workmanship claims the old demo copy made without any source (QA B10). */
const UNSOURCED_CRAFT = /dead level|every millimetre|well-compacted|set true|square and plumb|lived with for decades/i;

const has = (text: string, term: string) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(text);

function consentCriterion(c: GoldenCase, texts: Record<string, string>, assets: CaseReport["assets"]): Criterion {
  const t = c.testimonial;
  const responded = t?.status === "responded" && !t?.withdrawnAt;
  const problems: string[] = [];
  const all = Object.values(texts).join("\n");
  if (!c.expect.public) {
    return Object.keys(assets).length
      ? { id: "consent", ok: false, detail: "assets generated despite refused or withdrawn consent" }
      : { id: "consent", ok: true, detail: t?.withdrawnAt ? "no public assets (consent withdrawn)" : "no public assets (photos refused)" };
  }
  if (has(all, c.customer.lastName)) problems.push("surname used");
  if (!(responded && t?.consentFirstName) && new RegExp(`\\b${c.customer.firstName}\\b`).test(all)) problems.push("first name without consent");
  if (!(responded && t?.consentArea)) {
    if (has(all, c.area)) problems.push("area named without consent");
    if (all.includes(c.postcode.split(" ")[0])) problems.push("postcode district without consent");
    const slug = (assets.portfolio_page?.content as { slug?: string } | undefined)?.slug ?? "";
    if (slug.includes(slugify(c.area))) problems.push("area in slug without consent");
  }
  if (all.includes(c.postcode)) problems.push("full postcode");
  const quoteOk = responded && t?.consentQuote === true && !!t?.quote && (t?.rating ?? 0) >= 4;
  if (!quoteOk && t?.quote && all.includes(t.quote.slice(0, 24))) problems.push("testimonial quoted without eligibility");
  if (/\b(\d|five|four|three)[\s-]*stars?\b/i.test(all) && !(quoteOk && t?.rating === 5)) problems.push("star claim");
  if (!quoteOk && t?.rating && new RegExp(`\\b${t.rating}(\\s*/\\s*5| out of 5)`).test(all)) problems.push("homeowner rating shown without quote consent");
  const page = assets.portfolio_page?.content as { testimonial?: unknown } | undefined;
  if (!quoteOk && page?.testimonial) problems.push("testimonial block present");
  const json = JSON.stringify(Object.values(assets).map((a) => a!.content));
  for (const id of c.expect.excludedMedia) if (json.includes(id)) problems.push(`flagged photo ${id} used`);
  return { id: "consent", ok: problems.length === 0, detail: problems.join("; ") || "all consent rules respected" };
}

export async function runCase(c: GoldenCase): Promise<CaseReport> {
  const testimonial: GateTestimonial | null = c.testimonial
    ? { ...(c.testimonial as Omit<GateTestimonial, "withdrawnAt">), withdrawnAt: c.testimonial.withdrawnAt ? new Date(c.testimonial.withdrawnAt) : null }
    : null;
  const consent = decideConsent({ job: { area: c.area, postcode: c.postcode }, customer: c.customer, testimonial, config: THORBURN_CONFIG });
  const assets: CaseReport["assets"] = {};

  if (consent.publicAllowed) {
    const ctx = buildContentContext({
      job: { id: `eval_${c.id}`, code: "TL-EVAL", service: c.service, completedAt: new Date("2026-09-01"), createdAt: new Date("2026-08-01") },
      enrichment: null,
      media: c.media.map((m) => ({
        id: m.id,
        stage: m.stage as MediaStage,
        kind: "image" as const,
        publicKey: `eval/${m.id}.jpg`,
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
    for (const type of JOB_ASSET_TYPES) {
      const w = await writeJobAsset(type, ctx, consent);
      assets[type] = { content: w.content, checks: w.checks };
    }
  }

  const texts = Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, collectText(v!.content).join("\n")]));
  const criteria: Criterion[] = [consentCriterion(c, texts, assets)];
  if (consent.publicAllowed) {
    for (const [type, text] of Object.entries(texts)) {
      if (c.expect.thin) {
        const flagged = assets[type as JobAssetType]!.checks.some((k) => k.id === "thin-input" && !k.ok);
        criteria.push({ id: `thin-flagged:${type}`, ok: flagged, detail: flagged ? "reviewer asked for crew notes" : "thin input not flagged" });
      } else {
        const hits = c.expect.terms.filter((term) => has(text, term));
        criteria.push({ id: `specificity:${type}`, ok: hits.length >= 2, detail: `${hits.length} brief terms (${hits.join(", ")})` });
      }
      const craft = text.match(UNSOURCED_CRAFT);
      criteria.push({ id: `sourced:${type}`, ok: !craft, detail: craft ? `unsourced claim "${craft[0]}"` : "no generic workmanship claims" });
    }
    const areaWord = consent.area.name;
    for (const type of ["portfolio_page", "ad_copy", "gbp_post"]) {
      criteria.push({ id: `locality:${type}`, ok: has(texts[type] ?? "", areaWord), detail: `mentions "${areaWord}"` });
    }
    for (const [type, a] of Object.entries(assets)) {
      const failed = a!.checks.filter((k) => LINT_IDS.includes(k.id) && !k.ok);
      const byId = (id: string) => failed.filter((f) => f.id === id);
      criteria.push({ id: `banned:${type}`, ok: byId("banned-phrases").length === 0, detail: byId("banned-phrases").map((f) => f.message).join("; ") || "none" });
      criteria.push({ id: `cta:${type}`, ok: byId("cta").length === 0, detail: byId("cta").map((f) => f.message).join("; ") || "present" });
      criteria.push({ id: `lengths:${type}`, ok: byId("lengths").length === 0 && byId("schema").length === 0, detail: [...byId("lengths"), ...byId("schema")].map((f) => f.message).join("; ") || "within limits" });
      criteria.push({ id: `lint:${type}`, ok: failed.length === 0, detail: failed.map((f) => `${f.id}: ${f.message}`).join("; ") || "clean" });
    }
  }

  let premium: number | null = null;
  if (!usingMockAI() && assets.portfolio_page && assets.ad_copy) {
    const scores: number[] = [];
    for (const type of ["portfolio_page", "ad_copy"] as const) {
      const j = await generate("judge", JudgeSchema, {
        prompt: "judge",
        vars: { tenantName: THORBURN_CONFIG.name, bannedPhrases: THORBURN_CONFIG.voice.dontSay.map((p) => `"${p}"`).join(", "), assetType: type, content: JSON.stringify(assets[type]!.content, null, 2) },
        data: { assetType: type, content: assets[type]!.content, voice: THORBURN_CONFIG.voice.summary },
        maxTokens: 400,
      });
      scores.push(j.data.premium);
    }
    premium = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  const passed = criteria.filter((k) => k.ok).length;
  return {
    id: c.id,
    scenario: c.scenario,
    generated: consent.publicAllowed,
    criteria,
    score: passed / criteria.length,
    consentCompliant: criteria[0].ok,
    premium,
    assets,
  };
}

export async function runEvals(): Promise<EvalReport> {
  const cases: CaseReport[] = [];
  for (const c of golden.cases) cases.push(await runCase(c));
  const all = cases.flatMap((c) => c.criteria);
  const judged = cases.filter((c) => c.premium != null);
  return {
    provider: usingMockAI() ? "mock" : "anthropic",
    ranAt: new Date().toISOString(),
    cases,
    rubricPassRate: all.filter((k) => k.ok).length / all.length,
    consentCompliance: cases.filter((c) => c.consentCompliant).length / cases.length,
    premiumAverage: judged.length ? judged.reduce((a, c) => a + c.premium!, 0) / judged.length : null,
  };
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function renderMarkdown(r: EvalReport): string {
  const lines = [
    "# Content eval report",
    "",
    `Provider: **${r.provider}** · run ${r.ranAt}`,
    "",
    `- Rubric pass rate: **${pct(r.rubricPassRate)}**`,
    `- Consent compliance: **${pct(r.consentCompliance)}**`,
    `- Premium feel (LLM judge, 1–5): ${r.premiumAverage == null ? "not judged (mock mode)" : `**${r.premiumAverage.toFixed(2)}**`}`,
    "",
    "| Case | Scenario | Assets | Score | Consent | Premium | Failed criteria |",
    "|---|---|---|---|---|---|---|",
    ...r.cases.map((c) => {
      const failed = c.criteria.filter((k) => !k.ok).map((k) => `${k.id} (${k.detail})`).join("<br>") || "–";
      return `| ${c.id} | ${c.scenario} | ${c.generated ? Object.keys(c.assets).length : 0} | ${pct(c.score)} | ${c.consentCompliant ? "✓" : "✗"} | ${c.premium ?? "–"} | ${failed} |`;
    }),
    "",
    "## Sample output",
    "",
  ];
  for (const c of r.cases.filter((x) => x.generated)) {
    const page = c.assets.portfolio_page?.content as { h1: string; summary: string } | undefined;
    const ads = c.assets.ad_copy?.content as { meta: { hooks: string[]; primaryTexts: string[] } } | undefined;
    lines.push(`### ${c.id}`, "", `**H1:** ${page?.h1}`, "", `**Summary:** ${page?.summary}`, "", `**Hooks:** ${ads?.meta.hooks.join(" · ")}`, "", `**Primary text:** ${ads?.meta.primaryTexts[0]}`, "");
  }
  return lines.join("\n");
}

async function main() {
  const report = await runEvals();
  const dir = path.join(process.cwd(), "evals");
  await fs.writeFile(path.join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await fs.writeFile(path.join(dir, "report.md"), renderMarkdown(report) + "\n");
  console.log(`Rubric ${pct(report.rubricPassRate)} · consent ${pct(report.consentCompliance)} · premium ${report.premiumAverage ?? "n/a"} (${report.provider})`);
  for (const c of report.cases) console.log(`  ${c.id.padEnd(34)} ${pct(c.score).padStart(6)} ${c.criteria.filter((k) => !k.ok).map((k) => k.id).join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
