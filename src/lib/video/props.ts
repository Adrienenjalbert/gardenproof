/**
 * Pure props builder: job + media + testimonial + tenant → which videos to render and the exact
 * composition props for each. All consent gating and "real facts only" rules live here so they
 * are unit-tested without rendering.
 */
import type { Job, Media, Testimonial } from "@/db/schema";
import type { VideoRatio, VideoTemplate } from "@/lib/domain";
import { decideConsent, testimonialPermission } from "@/lib/content/consent";
import { checkPrivacy } from "@/lib/content/lint";
import { publishableImageKey } from "@/lib/privacy";
import { areaFromPostcode, serviceLabel, type TenantConfig } from "@/lib/tenant";
import { VideoPropsSchema, type VideoProps } from "../../../video/schema";
import { publicRef, storageRef } from "./refs";

export type VideoCheck = { id: string; ok: boolean; message: string };

export type VideoSpec = {
  template: VideoTemplate;
  ratio: VideoRatio;
  title: string;
  hook: string;
  props: VideoProps;
  checks: VideoCheck[];
};

export type VideoPlanInput = {
  config: TenantConfig;
  job: Pick<Job, "id" | "service" | "title" | "area" | "postcode" | "startedAt" | "completedAt" | "enrichment">;
  media: Pick<
    Media,
    "id" | "stage" | "kind" | "publicKey" | "blurredKey" | "privacyClearedAt" | "isHero" | "qualityScore" | "qualityNotes" | "createdAt"
  >[];
  testimonial: Pick<
    Testimonial,
    "status" | "rating" | "quote" | "consentPhotos" | "consentArea" | "consentFirstName" | "consentQuote" | "withdrawnAt"
  > | null;
  customerFirstName: string | null;
  /** Never shown; only used so the privacy lint can keep it off the screen. */
  customerLastName?: string | null;
  /** On-video hooks from the job's ad_copy (content.meta.hooks) and whether that copy is approved. */
  adCopy: { hooks: string[]; approved: boolean } | null;
};

/** Which templates × ratios to render. Process is only rendered when there is ≥1 progress photo. */
export type VideoPlanOptions = { formats?: Partial<Record<VideoTemplate, VideoRatio[]>> };

export const DEFAULT_FORMATS: Record<VideoTemplate, VideoRatio[]> = {
  reveal: ["9:16", "1:1", "16:9"],
  proof: ["9:16", "1:1"],
  process: ["9:16", "1:1", "16:9"],
};

export type VideoPlan = { specs: VideoSpec[]; skipped: string | null };

const DAY = 24 * 3600 * 1000;
const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
/** Hooks longer than this are cut off on 9:16; the ad-copy contract asks for <= 6 words. */
const MAX_HOOK_WORDS = 8;
const MAX_HOOK_CHARS = 60;
/** The Proof quote card holds this much; a longer quote is left out, never shortened. */
export const MAX_VIDEO_QUOTE = 240;

/** A job photo plus the one key that may be shown publicly (see @/lib/privacy). */
type Photo = VideoPlanInput["media"][number] & { key: string };

function pickPhoto(photos: Photo[], preferredId: string | null | undefined): Photo | null {
  if (photos.length === 0) return null;
  return (
    photos.find((m) => m.id === preferredId) ??
    photos.find((m) => m.isHero) ??
    [...photos].sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))[0]!
  );
}

/** Up to `n` items spread evenly across the list (keeps first and last). */
export function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  if (n === 1) return [items[Math.floor(items.length / 2)]!];
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]!);
}

/** "Day 3" in the first week, then "Week 2" etc., relative to the job start. */
export function progressLabel(takenAt: Date, startedAt: Date): string {
  const day = Math.max(1, Math.floor((takenAt.getTime() - startedAt.getTime()) / DAY) + 1);
  return day <= 6 ? `Day ${day}` : `Week ${Math.ceil(day / 7)}`;
}

/** Days on site: crew-reported (enrichment) first, else job dates; null when unknown. */
export function daysOnSite(job: VideoPlanInput["job"]): number | null {
  if (job.enrichment?.durationDays) return job.enrichment.durationDays;
  if (!job.completedAt) return null;
  const days = Math.round((job.completedAt.getTime() - job.startedAt.getTime()) / DAY);
  return days > 0 ? days : null;
}

export function durationLabel(days: number | null): string | null {
  if (!days) return null;
  if (days < 7) return days === 1 ? "1 day on site" : `${days} days on site`;
  const weeks = Math.round(days / 7);
  return weeks === 1 ? "1 week on site" : `${weeks} weeks on site`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Remove a place name from free text ("Pond garden, Wimbledon" → "Pond garden"). */
export function stripPlace(text: string, place: string | null): string {
  if (!place) return text.trim();
  return text
    .replace(new RegExp(`\\s*(,|—|-|–|\\bin\\b)?\\s*\\b${escapeRe(place)}\\b`, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,–—-]+$/, "")
    .trim();
}

/** Specific service line, never leaking the area when the homeowner has not consented to it. */
export function serviceLineFor(job: VideoPlanInput["job"], config: TenantConfig): string {
  const places = [job.area, areaFromPostcode(job.postcode, config)].filter((x): x is string => !!x);
  let line = job.title ?? "";
  for (const p of places) line = stripPlace(line, p);
  if (!line) {
    const key = job.enrichment?.service ?? job.service;
    line = key ? serviceLabel(key, config) : "Garden landscaping";
  }
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

/** Keep usable ad-copy hooks: short, not banned, and not naming anything we lack consent for. */
export function usableHooks(hooks: string[] | null, config: TenantConfig, forbidden: string[]): string[] {
  if (!hooks) return [];
  const banned = config.voice.dontSay.map((b) => b.toLowerCase());
  return hooks
    .map((h) => h.replace(/\s+/g, " ").trim())
    .filter((h) => h.length > 0 && h.length <= MAX_HOOK_CHARS && h.split(" ").length <= MAX_HOOK_WORDS)
    .filter((h) => !banned.some((b) => h.toLowerCase().includes(b)))
    .filter((h) => !forbidden.some((f) => new RegExp(`\\b${escapeRe(f)}\\b`, "i").test(h)));
}

export function defaultHook(
  template: VideoTemplate,
  ctx: { hasBefore: boolean; days: number | null; area: string | null; hasQuote: boolean; rating: number | null },
): string {
  const weeks = ctx.days && ctx.days >= 7 ? Math.round(ctx.days / 7) : null;
  const span = weeks ? `${numberWord(weeks)} week${weeks > 1 ? "s" : ""}` : ctx.days ? `${numberWord(ctx.days)} day${ctx.days > 1 ? "s" : ""}` : null;
  if (template === "reveal" && ctx.hasBefore) return span ? `Same garden. ${span} apart.` : "Same garden. Before and after.";
  if (template === "process") return span ? `${span}, start to finish.` : "Start to finish.";
  if (template === "proof" && ctx.hasQuote) return "In the homeowner’s words.";
  if (ctx.rating === 5) return "Rated 5/5 by the homeowner.";
  return ctx.area ? `Finished in ${ctx.area}.` : "Finished and handed over.";
}

const HOOK_SLOT: Record<VideoTemplate, number> = { reveal: 0, proof: 1, process: 2 };

function websiteLabel(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the privacy lint needs to know about this job (from the shared consent decision). */
export type TextGate = { areaNamed: boolean; outwardCode: string | null; forbidden: { term: string; reason: string }[] };

/** Same privacy lint as the copy (addresses, house numbers, full postcodes, surnames, non-consented names). */
export function textProblem(text: string | null, gate: TextGate): string | null {
  if (!text) return null;
  const c = checkPrivacy(text, null, gate);
  return c.ok ? null : c.message;
}

function consentFor(input: VideoPlanInput) {
  return decideConsent({
    job: input.job,
    customer: input.customerFirstName || input.customerLastName ? { firstName: input.customerFirstName ?? "", lastName: input.customerLastName ?? null } : null,
    testimonial: input.testimonial,
    config: input.config,
  });
}

/** Consent + privacy view of a job for on-screen text (shared by planning and re-rendering). */
export function textGateFor(input: VideoPlanInput): TextGate {
  const c = consentFor(input);
  return { areaNamed: c.area.named, outwardCode: c.area.outwardCode, forbidden: c.forbidden };
}

/** Why a reviewer-edited hook cannot be burned into the video, or null when it can. */
export function hookProblem(hook: string, input: VideoPlanInput): string | null {
  const gate = textGateFor(input);
  if (usableHooks([hook], input.config, gate.forbidden.map((f) => f.term)).length === 0) {
    return "hook is too long, uses a banned phrase or names something the homeowner has not consented to";
  }
  return textProblem(hook, gate);
}

export function buildVideoPlan(input: VideoPlanInput, options: VideoPlanOptions = {}): VideoPlan {
  const { config, job, testimonial: t } = input;
  if (t?.withdrawnAt) return { specs: [], skipped: "Homeowner withdrew consent" };
  if (t?.consentPhotos === false) return { specs: [], skipped: "Homeowner declined photo consent" };

  const consent = consentFor(input);
  const gate: TextGate = { areaNamed: consent.area.named, outwardCode: consent.area.outwardCode, forbidden: consent.forbidden };
  // Only images the shared privacy rule allows (flagged/unscreened ones wait for a blur or clearance).
  const images: Photo[] = input.media
    .flatMap((m) => {
      const key = publishableImageKey(m);
      return key ? [{ ...m, key }] : [];
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const after = pickPhoto(images.filter((m) => m.stage === "after"), job.enrichment?.heroAfterMediaId);
  if (!after) return { specs: [], skipped: "No publishable after photo yet (missing, or waiting for a blur / privacy clearance)" };
  const before = pickPhoto(images.filter((m) => m.stage === "before"), job.enrichment?.heroBeforeMediaId);
  const progress = spread(images.filter((m) => m.stage === "progress"), 3);

  const checks: VideoCheck[] = [];
  const dropped: string[] = [];
  const area = consent.area.named ? consent.area.name : null;

  // Testimonial: one permission for words AND score (consentQuote, rating >= 4, not withdrawn).
  const permission = testimonialPermission(t);
  if (!permission.ok && permission.reason) {
    checks.push({ id: "testimonial-withheld", ok: true, message: `No quote or stars: ${permission.reason}` });
  }
  let quote = permission.ok ? permission.quote : null;
  if (quote && quote.length > MAX_VIDEO_QUOTE) {
    checks.push({ id: "quote-length", ok: true, message: `Homeowner quote is ${quote.length} characters (max ${MAX_VIDEO_QUOTE} on video): left out rather than shortened` });
    quote = null;
  }
  const rating = permission.ok ? permission.rating : null;
  let attribution = quote ? [consent.firstName ?? "Homeowner", area].filter(Boolean).join(", ") : null;
  const quoteIssue = textProblem(quote, gate) ?? textProblem(attribution, gate);
  if (quoteIssue) {
    dropped.push(`homeowner quote (${quoteIssue})`);
    quote = null;
    attribution = null;
  }

  const whichRating = config.proof.whichRating && /^[0-5](\.\d)?$/.test(config.proof.whichRating) ? config.proof.whichRating : null;
  const days = daysOnSite(job);
  const hooks = usableHooks(input.adCopy?.hooks ?? null, config, gate.forbidden.map((f) => f.term)).filter((h) => !textProblem(h, gate));

  let serviceLine = serviceLineFor(job, config);
  const lineIssue = textProblem(serviceLine, gate);
  if (lineIssue) {
    dropped.push(`service line "${serviceLine}" (${lineIssue})`);
    const key = job.enrichment?.service ?? job.service;
    serviceLine = key ? serviceLabel(key, config) : "Garden landscaping";
  }

  const src = (m: Photo) => storageRef(m.key);
  const base: Omit<VideoProps, "ratio" | "hook"> = {
    beforeSrc: before ? src(before) : null,
    afterSrc: src(after),
    progressSrcs: progress.map(src),
    progressLabels: progress.map((m) => progressLabel(m.createdAt, job.startedAt)),
    serviceLine,
    areaLine: area,
    durationLabel: durationLabel(days),
    quote,
    quoteAttribution: attribution,
    rating,
    whichRating,
    brandName: config.name.slice(0, 40),
    ctaText: config.cta.text.slice(0, 48),
    website: websiteLabel(config.website),
    logoSrc: config.brand.logoPath ? publicRef(config.brand.logoPath) : null,
    brand: {
      primary: config.brand.primary,
      primaryDark: config.brand.primaryDark,
      accent: config.brand.accent,
      text: config.brand.text,
    },
  };

  checks.unshift(
    consent.photoConsent === "given"
      ? { id: "consent-photos", ok: true, message: "Homeowner consented to photos" }
      : { id: "consent-photos", ok: false, message: "Awaiting homeowner photo consent: do not publish yet" },
    { id: "public-derivative", ok: true, message: "Uses only privacy-safe photo copies (EXIF stripped; flagged photos blurred or cleared)" },
    {
      id: "privacy",
      ok: true,
      message: dropped.length ? `Left out of the video: ${dropped.join("; ")}` : "No address, postcode or non-consented name in on-screen text",
    },
    ...(whichRating ? [{ id: "which-rating", ok: false, message: `Confirm the Which? rating (${whichRating}) is current before publishing` }] : []),
  );

  const formats = { ...DEFAULT_FORMATS, ...options.formats };
  const specs: VideoSpec[] = [];
  for (const template of ["reveal", "proof", "process"] as const) {
    if (template === "process" && progress.length === 0) continue;
    const fromAdCopy = hooks[HOOK_SLOT[template]] ?? hooks[0];
    const fallback = defaultHook(template, { hasBefore: !!before, days, area, hasQuote: !!quote, rating });
    const hook = fromAdCopy ?? (textProblem(fallback, gate) ? "Finished and handed over." : fallback);
    const notes: VideoCheck[] = [
      hookSourceCheck(fromAdCopy ? (input.adCopy?.approved ? "approved" : "in_review") : "default"),
      ...(template === "reveal" && !before
        ? [{ id: "fallback", ok: true, message: "No before photo: rendered as an after-only hero spot" }]
        : []),
      ...(template === "proof" && !quote ? [{ id: "fallback", ok: true, message: "No homeowner quote: quote section skipped" }] : []),
    ];
    for (const ratio of formats[template] ?? []) {
      const props = VideoPropsSchema.parse({ ...base, ratio, hook });
      specs.push({
        template,
        ratio,
        hook,
        props,
        title: `${cap(template)} · ${ratio} · ${job.title ?? serviceLine}`,
        checks: [...checks, ...notes],
      });
    }
  }
  return { specs, skipped: null };
}

/** Only a hook from approved ad copy (or typed by the reviewer) is "ok"; anything else needs a read. */
export function hookSourceCheck(source: "approved" | "in_review" | "default" | "reviewer"): VideoCheck {
  switch (source) {
    case "approved":
      return { id: "hook-source", ok: true, message: "Hook from approved ad copy" };
    case "reviewer":
      return { id: "hook-source", ok: true, message: "Hook written by the reviewer" };
    case "in_review":
      return { id: "hook-source", ok: false, message: "Hook comes from ad copy that is still in review: approve the ad copy (or edit the hook) before publishing" };
    case "default":
      return { id: "hook-source", ok: false, message: "Default hook written from job facts (no approved ad copy yet): check it, or edit it, before publishing" };
  }
}
