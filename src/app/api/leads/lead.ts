/**
 * Lead payload validation and attribution mapping (pure; used by route.ts and unit tests).
 *
 * The website tracker (public/gp-track.js) sends the enquiry fields plus a first-touch and last-touch
 * snapshot. The leads table has one set of attribution columns, so we store:
 *  - source/medium/campaign/content/term/landing page/referrer from the FIRST touch (what brought them),
 *  - gclid/fbclid from the LAST touch (the click that converted — what ad platforms need for offline import).
 * The complete first and last touch are also kept verbatim (validated) in `leads.attribution`.
 */
import { z } from "zod";

/** Optional trimmed text; "" becomes undefined so empty form fields are not stored. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || undefined)
    .optional();

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const TouchSchema = z.object({
  source: optionalText(100),
  medium: optionalText(100),
  campaign: optionalText(200),
  content: optionalText(200),
  term: optionalText(200),
  gclid: optionalText(200),
  fbclid: optionalText(500),
  landingPage: optionalText(2000),
  referrer: optionalText(2000),
  ts: z.number().int().positive().optional(),
});
export type Touch = z.infer<typeof TouchSchema>;

export const LeadPayloadSchema = z
  .object({
    tenant: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .optional(),
    name: optionalText(120),
    email: z.preprocess(emptyToUndefined, z.email().max(254).optional()),
    phone: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .regex(/^[+\d][\d\s().-]{5,39}$/, "Invalid phone number")
        .optional(),
    ),
    postcode: optionalText(12),
    service: optionalText(80),
    message: optionalText(4000),
    projectSlug: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,199}$/i)
        .optional(),
    ),
    first: TouchSchema.optional(),
    last: TouchSchema.optional(),
    /** Honeypot: a hidden field humans never fill. */
    hp: z.string().max(500).optional(),
  })
  .refine((l) => l.email || l.phone, { message: "Provide an email address or phone number", path: ["email"] });
export type LeadPayload = z.infer<typeof LeadPayloadSchema>;

export const isBot = (lead: { hp?: string }) => !!lead.hp?.trim();

type Inferred = { source: string; medium: string };

/** Classify a visit with no utm_source from its click ids or referrer. */
export function inferSource(touch: Touch | undefined): Inferred {
  if (touch?.gclid) return { source: "google", medium: "cpc" };
  if (touch?.fbclid) return { source: "facebook", medium: "social" };
  if (!touch?.referrer) return { source: "direct", medium: "none" };
  let host: string;
  try {
    host = new URL(touch.referrer).hostname.replace(/^www\./, "");
  } catch {
    return { source: "direct", medium: "none" };
  }
  if (/(^|\.)google\./.test(host) || /(^|\.)bing\.com$/.test(host) || /(^|\.)duckduckgo\.com$/.test(host)) {
    return { source: host.split(".")[0], medium: "organic" };
  }
  if (/(^|\.)(facebook|instagram|fb)\.com$/.test(host) || host === "l.facebook.com") {
    return { source: host.includes("instagram") ? "instagram" : "facebook", medium: "social" };
  }
  return { source: host, medium: "referral" };
}

export type AttributionColumns = {
  source: string;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  gclid: string | null;
  fbclid: string | null;
  landingPage: string | null;
  referrer: string | null;
};

export function attributionColumns(lead: Pick<LeadPayload, "first" | "last">): AttributionColumns {
  const first = lead.first ?? lead.last;
  const last = lead.last ?? lead.first;
  const inferred = inferSource(first);
  return {
    source: first?.source ?? inferred.source,
    medium: first?.source ? (first.medium ?? null) : inferred.medium,
    campaign: first?.campaign ?? null,
    content: first?.content ?? null,
    term: first?.term ?? null,
    gclid: last?.gclid ?? first?.gclid ?? null,
    fbclid: last?.fbclid ?? first?.fbclid ?? null,
    landingPage: first?.landingPage ?? null,
    referrer: first?.referrer ?? null,
  };
}

export type LeadAttribution = { first: Touch | null; last: Touch | null };

/** Full first + last touch for `leads.attribution` (validated and trimmed by TouchSchema). */
export function attributionJson(lead: Pick<LeadPayload, "first" | "last">): LeadAttribution {
  const clean = (t: Touch | undefined) =>
    t ? (Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)) as Touch) : null;
  return { first: clean(lead.first), last: clean(lead.last) };
}

/**
 * Every export (ad CSVs, videos, social/GBP links) tags URLs with utm_content=asset_<assetId>, whatever the asset
 * type. Returns candidate asset ids, first touch first, for the route to check against the database.
 */
export function assetIdCandidates(lead: Pick<LeadPayload, "first" | "last">): string[] {
  const ids = [lead.first?.content, lead.last?.content]
    .map((c) => c?.match(/^asset_([A-Za-z0-9_-]{3,64})$/)?.[1])
    .filter((id): id is string => !!id);
  return [...new Set(ids)];
}
