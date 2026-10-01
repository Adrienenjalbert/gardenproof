/**
 * Internal contracts of the content engine. ContentContext is the ONLY thing a copywriter
 * (real model or mock) sees: consent has already been applied when it is built, so whatever
 * ends up in copy is, by construction, allowed to be public.
 */
import type { MediaStage } from "@/lib/domain";

export type Check = { id: string; ok: boolean; message: string };

export type ContextMedia = {
  id: string;
  stage: MediaStage;
  isHero: boolean;
  qualityScore: number | null;
  /** Publishable storage key from `publishableImageKey` (EXIF-stripped, blurred or operator-cleared). */
  publicKey: string;
};

export type ContextTestimonial = { quote: string; rating: number; attribution: string };

export type ContentContext = {
  tenant: {
    name: string;
    shortName: string;
    website: string;
    projectsUrl: string;
    cta: { text: string; url: string };
    voiceSummary: string;
    doSay: string[];
    dontSay: string[];
    whichRating: string | null;
    /** Other neighbourhoods the tenant serves (safe to list; never includes a non-consented job area). */
    serviceAreas: string[];
  };
  job: {
    id: string;
    code: string;
    service: string;
    serviceLabel: string;
    serviceNoun: string;
    year: number;
  };
  facts: {
    features: string[];
    materials: string[];
    plants: string[];
    durationDays: number | null;
    durationText: string | null;
    challenge: string | null;
    result: string | null;
    style: string | null;
    /** Crew-note clauses describing the finished scope (crew's own words). */
    scope: string[];
  };
  /** Crew notes + voice-note transcripts: the factual source for every claim. */
  crewNotes: string;
  area: {
    /** Name to use in copy: the neighbourhood if consented, else the generic region. */
    name: string;
    named: boolean;
    outwardCode: string | null;
  };
  testimonial: ContextTestimonial | null;
  photoConsent: "given" | "unconfirmed";
  media: ContextMedia[];
  heroBeforeId: string | null;
  heroAfterId: string | null;
  /** Free-text reviewer note from "regenerate with note". */
  instructions: string | null;
  /** Consent/privacy decisions to surface to the reviewer as checks. */
  notes: Check[];
};

/** Everything lintAsset needs; derived from ContentContext + the raw (private) job data. */
export type LintContext = {
  bannedPhrases: string[];
  mediaIds: string[];
  /** Crew notes, enrichment facts, testimonial and tenant proof: numbers/claims must come from here. */
  sourceText: string;
  rating: number | null;
  /** The consented homeowner quote (null = no quote may appear anywhere). Quoted text must match it verbatim. */
  quote: string | null;
  /** Tenant CTA text: the sentence before it must be closed ("…Wimbledon. Book a consultation"). */
  ctaText: string | null;
  whichRating: string | null;
  areaNamed: boolean;
  outwardCode: string | null;
  /** Terms that must never appear (surname, non-consented first name / area). */
  forbidden: { term: string; reason: string }[];
  year: number;
};

export type SeoClusterPage = {
  jobId: string;
  slug: string;
  h1: string;
  summary: string;
  materials: string[];
  features: string[];
  duration: string | null;
  url: string;
};

export type SeoContext = {
  tenant: ContentContext["tenant"];
  service: string;
  serviceLabel: string;
  serviceNoun: string;
  area: string;
  pages: SeoClusterPage[];
  year: number;
  instructions: string | null;
};
