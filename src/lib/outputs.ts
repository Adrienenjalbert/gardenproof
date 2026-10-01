/**
 * What GardenProof makes for each finished job. Lean by default: a project page, a Google Business post and one
 * portrait video are what almost every business uses, and every extra item is one more thing to approve.
 * Ad copy, social captions, area articles and the other video shapes are switched on per business
 * (More › Your business › What we make). Stored in tenants.settings.outputs.
 */
export type ContentOutputs = {
  /** Google / Meta ad copy (also supplies the on-video hooks). For businesses that run ads. */
  ads: boolean;
  /** Instagram / Facebook caption pack. */
  social: boolean;
  /** "Patios in Wimbledon"-style area articles for the website. */
  areaArticles: boolean;
  /** Every video template and shape (square, landscape, the proof and process cuts), not just the portrait reveal. */
  allVideoFormats: boolean;
};

export const DEFAULT_OUTPUTS: ContentOutputs = { ads: false, social: false, areaArticles: false, allVideoFormats: false };

export const OUTPUT_KEYS = ["ads", "social", "areaArticles", "allVideoFormats"] as const;

export function readOutputs(settings: unknown): ContentOutputs {
  const raw = (settings as { outputs?: Partial<ContentOutputs> } | null | undefined)?.outputs ?? {};
  const out = { ...DEFAULT_OUTPUTS };
  for (const k of OUTPUT_KEYS) if (typeof raw[k] === "boolean") out[k] = raw[k];
  return out;
}

/** Text assets written for a job, in order. The project page and the Google post are always made. */
export function jobAssetTypesFor(o: ContentOutputs): Array<"portfolio_page" | "ad_copy" | "social_pack" | "gbp_post"> {
  return [
    "portfolio_page",
    ...(o.ads ? (["ad_copy"] as const) : []),
    ...(o.social ? (["social_pack"] as const) : []),
    "gbp_post",
  ];
}

/** Video shapes to render; undefined = every default format. The lean default is one portrait reveal. */
export function videoFormatsFor(o: ContentOutputs) {
  if (o.allVideoFormats) return undefined;
  return { reveal: ["9:16" as const], proof: [], process: [] };
}
