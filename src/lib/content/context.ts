/**
 * Builds the consent-filtered ContentContext (what copywriters see) and the LintContext
 * (what the checker needs) from raw job data. Pure: DB loading lives in ./load.ts.
 */
import type { Job, Media } from "@/db/schema";
import type { JobEnrichment } from "@/lib/domain";
import { publishableImageKey } from "@/lib/privacy";
import { serviceLabel, type TenantConfig } from "@/lib/tenant";
import type { ConsentDecision } from "./consent";
import { extractFacts, rankFeatures, SERVICE_NOUNS } from "./lexicon";
import { formatDuration } from "./text";
import type { Check, ContentContext, ContextMedia, LintContext } from "./types";

export type ContextInput = {
  job: Pick<Job, "id" | "code" | "service" | "completedAt" | "createdAt">;
  enrichment: JobEnrichment | null;
  media: Pick<Media, "id" | "stage" | "kind" | "publicKey" | "blurredKey" | "privacyClearedAt" | "isHero" | "qualityScore" | "qualityNotes">[];
  crewNotes: string;
  consent: ConsentDecision;
  config: TenantConfig;
  instructions?: string | null;
};

/** Below this, an image is not shown publicly (too dark / blurry). */
export const MIN_PUBLIC_QUALITY = 0.3;

/**
 * Images that are safe and good enough to show. Safety is the shared rule (`publishableImageKey`):
 * flagged or unscreened images only come back once blurred or cleared by the operator.
 */
export function publicMedia(media: ContextInput["media"]): { usable: ContextMedia[]; excluded: string[] } {
  const usable: ContextMedia[] = [];
  const excluded: string[] = [];
  for (const m of media) {
    if (m.kind !== "image") continue;
    const key = publishableImageKey(m);
    const lowQuality = m.qualityScore != null && m.qualityScore < MIN_PUBLIC_QUALITY;
    if (!key || lowQuality) {
      excluded.push(m.id);
      continue;
    }
    usable.push({ id: m.id, stage: m.stage, isHero: m.isHero, qualityScore: m.qualityScore, publicKey: key });
  }
  return { usable, excluded };
}

/** No crew brief / voice note, or nothing concrete in it: copy can only say service + area + photos. */
export function thinInputCheck(crewNotes: string, facts: { features: string[]; materials: string[]; scope: string[] }): Check | null {
  if (!crewNotes.trim()) {
    return {
      id: "thin-input",
      ok: false,
      message: "No crew brief or voice note for this job, so the copy only uses the service, area and photos. Add crew notes (what was built, materials, how long) and regenerate.",
    };
  }
  if (!facts.features.length && !facts.materials.length && !facts.scope.length) {
    return {
      id: "thin-input",
      ok: false,
      message: "The crew notes name no features or materials, so the copy stays general. Add what was built and with which materials, then regenerate.",
    };
  }
  return null;
}

/**
 * Area names in a stable, sensible order: the tenant's main postcode prefix first (e.g. SW), then by
 * district number. (jsonb does not preserve key order, so config.areas order can't be relied on.)
 */
export function servedAreas(config: TenantConfig): string[] {
  const prefix = (code: string) => code.match(/^[A-Z]+/)?.[0] ?? "";
  const count = new Map<string, number>();
  for (const code of Object.keys(config.areas)) count.set(prefix(code), (count.get(prefix(code)) ?? 0) + 1);
  const sorted = Object.keys(config.areas).sort(
    (a, b) => (count.get(prefix(b)) ?? 0) - (count.get(prefix(a)) ?? 0) || prefix(a).localeCompare(prefix(b)) || parseInt(a.slice(prefix(a).length)) - parseInt(b.slice(prefix(b).length)),
  );
  return [...new Set(sorted.map((k) => config.areas[k]))];
}

/** Tenant facts for copywriters. `hiddenArea` is left out of the served-areas list (no consent to name it). */
export function tenantView(config: TenantConfig, hiddenArea: string | null): ContentContext["tenant"] {
  return {
    name: config.name,
    shortName: config.name.split(" ")[0],
    website: config.website,
    projectsUrl: config.wordpress ? `${config.wordpress.baseUrl.replace(/\/$/, "")}${config.wordpress.projectsPath}` : config.website,
    cta: config.cta,
    voiceSummary: config.voice.summary,
    doSay: config.voice.doSay,
    dontSay: config.voice.dontSay,
    whichRating: config.proof.whichRating,
    serviceAreas: servedAreas(config).filter((a) => a !== hiddenArea),
  };
}

export function buildContentContext(input: ContextInput): ContentContext {
  const { job, enrichment, config, consent } = input;
  const service = enrichment?.service && config.services.some((s) => s.key === enrichment.service)
    ? enrichment.service
    : (job.service ?? "full_design");
  const extracted = extractFacts(input.crewNotes);
  const features = enrichment?.features.length ? enrichment.features : extracted.features;
  const durationDays = enrichment?.durationDays ?? extracted.durationDays;
  const materials = enrichment?.materials.length ? enrichment.materials : extracted.materials;
  const { usable, excluded } = publicMedia(input.media);
  const ids = new Set(usable.map((m) => m.id));
  const pickHero = (stage: "before" | "after", preferred: string | null | undefined) =>
    (preferred && ids.has(preferred) ? preferred : null) ??
    usable.filter((m) => m.stage === stage).sort((a, b) => Number(b.isHero) - Number(a.isHero) || (b.qualityScore ?? 0.5) - (a.qualityScore ?? 0.5))[0]?.id ??
    null;

  const notes = [...consent.notes];
  if (excluded.length) {
    notes.push({
      id: "media-excluded",
      ok: true,
      message: `Left out ${excluded.length} image(s) that are not public-safe yet (needs blur, not privacy-screened, low quality or no public copy): ${excluded.join(", ")}.`,
    });
  }
  const thin = thinInputCheck(input.crewNotes, { features, materials, scope: extracted.scope });
  if (thin) notes.push(thin);

  return {
    tenant: tenantView(config, consent.area.named ? null : consent.privateArea),
    job: {
      id: job.id,
      code: job.code,
      service,
      serviceLabel: serviceLabel(service, config),
      serviceNoun: SERVICE_NOUNS[service] ?? serviceLabel(service, config).toLowerCase(),
      year: (job.completedAt ?? job.createdAt ?? new Date()).getFullYear(),
    },
    facts: {
      features: rankFeatures(features, service),
      materials,
      plants: enrichment?.plants.length ? enrichment.plants : extracted.plants,
      durationDays,
      durationText: extracted.durationText ?? formatDuration(durationDays),
      challenge: enrichment?.challenge ?? extracted.challenge,
      result: enrichment?.result ?? null,
      style: enrichment?.style ?? extracted.style,
      scope: extracted.scope,
    },
    crewNotes: input.crewNotes,
    area: consent.area,
    testimonial: consent.testimonial,
    photoConsent: consent.photoConsent === "given" ? "given" : "unconfirmed",
    media: usable,
    heroBeforeId: pickHero("before", enrichment?.heroBeforeMediaId),
    heroAfterId: pickHero("after", enrichment?.heroAfterMediaId),
    instructions: input.instructions?.trim() || null,
    notes,
  };
}

export function lintContextFor(ctx: ContentContext, consent: Pick<ConsentDecision, "forbidden">): LintContext {
  const f = ctx.facts;
  return {
    bannedPhrases: ctx.tenant.dontSay,
    mediaIds: ctx.media.map((m) => m.id),
    sourceText: [
      ctx.crewNotes,
      ...f.features, ...f.materials, ...f.plants,
      f.durationText ?? "", f.durationDays ? `${f.durationDays} days` : "",
      f.challenge ?? "", f.result ?? "",
      ctx.testimonial?.quote ?? "",
      ctx.tenant.whichRating ? `rated ${ctx.tenant.whichRating}` : "",
    ].join("\n"),
    rating: ctx.testimonial?.rating ?? null,
    quote: ctx.testimonial?.quote ?? null,
    ctaText: ctx.tenant.cta.text,
    whichRating: ctx.tenant.whichRating,
    areaNamed: ctx.area.named,
    outwardCode: ctx.area.outwardCode,
    forbidden: consent.forbidden,
    year: ctx.job.year,
  };
}
