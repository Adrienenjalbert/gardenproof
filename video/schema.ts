/**
 * Props contract for every GardenProof video composition.
 *
 * Kept free of Remotion / React imports so the app (src/lib/video) can validate props
 * and compute durations without pulling the renderer into Next.js or unit tests.
 */
import { z } from "zod";

export const RATIOS = ["9:16", "1:1", "16:9"] as const;
export type Ratio = (typeof RATIOS)[number];

export const TEMPLATES = ["reveal", "proof", "process"] as const;
export type Template = (typeof TEMPLATES)[number];

export const FPS = 30;

export const RATIO_DIMENSIONS: Record<Ratio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

/** Composition ids registered in video/Root.tsx, one per template. */
export const COMPOSITION_IDS: Record<Template, string> = {
  reveal: "Reveal",
  proof: "Proof",
  process: "Process",
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB colour");

export const BrandSchema = z.object({
  primary: hex, // end-card olive
  primaryDark: hex,
  accent: hex, // word highlight
  text: hex,
});
export type Brand = z.infer<typeof BrandSchema>;

/**
 * Media fields are URLs the headless browser can fetch (http(s) or data:).
 * The app persists them as portable refs ("storage:<key>", "public:<path>") and resolves
 * them to a local static server just before rendering — see src/lib/video/render.ts.
 */
export const VideoPropsSchema = z.object({
  ratio: z.enum(RATIOS),
  beforeSrc: z.string().min(1).nullable(),
  afterSrc: z.string().min(1),
  progressSrcs: z.array(z.string().min(1)).max(3),
  /** One label per progress shot, e.g. "Week 1". Missing labels fall back to "Stage n". */
  progressLabels: z.array(z.string()),
  /** On-video hook, shown in the first second. Keep to ~6 words. */
  hook: z.string().min(1).max(80),
  /** Specific service, e.g. "Pond & gravel garden". */
  serviceLine: z.string().min(1).max(60),
  /** Public neighbourhood (only with homeowner consent), e.g. "Wimbledon". */
  areaLine: z.string().max(40).nullable(),
  /** e.g. "3 weeks on site" — from job dates / crew notes, never guessed. */
  durationLabel: z.string().max(30).nullable(),
  /** Homeowner quote (only with a responded testimonial). */
  quote: z.string().max(240).nullable(),
  quoteAttribution: z.string().max(60).nullable(),
  /** Homeowner star rating 1-5 (only a real rating). */
  rating: z.number().int().min(1).max(5).nullable(),
  /** Tenant's Which? Trusted Trader score, e.g. "4.9". */
  whichRating: z
    .string()
    .regex(/^[0-5](\.\d)?$/)
    .nullable(),
  /** Business name, shown small beside the area so the brand registers before the end card. */
  brandName: z.string().min(1).max(40),
  ctaText: z.string().min(1).max(48),
  website: z.string().min(1).max(48),
  logoSrc: z.string().min(1).nullable(),
  brand: BrandSchema,
});
export type VideoProps = z.infer<typeof VideoPropsSchema>;
