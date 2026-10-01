/**
 * Lead attribution for the lead log (QA B2). The Phase-1 goal is proving WHICH content brings enquiries, so a
 * lead is credited to any asset type (video, ad copy, portfolio page…) via `leads.assetId` or `utm_content`
 * (`asset_<id>`), and first- vs last-touch come from `leads.attribution` ({ first, last }).
 */
import type { AssetType } from "@/lib/domain";

export type TouchView = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  landingPage: string | null;
  referrer: string | null;
  at: Date | null;
};

const text = (v: unknown, max = 2000): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

function toTouch(v: unknown): TouchView | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const t: TouchView = {
    source: text(o.source, 100),
    medium: text(o.medium, 100),
    campaign: text(o.campaign, 200),
    content: text(o.content, 200),
    landingPage: text(o.landingPage),
    referrer: text(o.referrer),
    at: typeof o.ts === "number" && Number.isFinite(o.ts) ? new Date(o.ts) : null,
  };
  return Object.values(t).some((x) => x !== null) ? t : null;
}

/** Tolerant parse of the jsonb column (older rows have null; the shape is not enforced by the DB). */
export function parseAttribution(v: unknown): { first: TouchView | null; last: TouchView | null } {
  if (!v || typeof v !== "object") return { first: null, last: null };
  const o = v as Record<string, unknown>;
  return { first: toTouch(o.first), last: toTouch(o.last) };
}

/** Asset id carried in utm_content: "asset_<id>" (what our ad bundles write) or a bare id. */
export function assetIdFromUtmContent(content: string | null | undefined): string | null {
  const c = content?.trim();
  if (!c) return null;
  return c.match(/^asset_([A-Za-z0-9_-]{3,64})$/)?.[1] ?? (/^[A-Za-z0-9_-]{3,64}$/.test(c) ? c : null);
}

/** Candidate asset ids for a lead, strongest first: stored match, then first touch, last touch, column. */
export function leadAssetCandidates(l: {
  assetId: string | null;
  content: string | null;
  attribution: unknown;
}): string[] {
  const a = parseAttribution(l.attribution);
  const ids = [l.assetId, assetIdFromUtmContent(a.first?.content), assetIdFromUtmContent(a.last?.content), assetIdFromUtmContent(l.content)];
  return [...new Set(ids.filter((x): x is string => !!x))];
}

export type ContentKind = AssetType | "portfolio_visit" | "none";

const KIND_LABEL: Record<ContentKind, [singular: string, plural: string]> = {
  portfolio_page: ["portfolio page", "portfolio pages"],
  portfolio_visit: ["portfolio page", "portfolio pages"],
  video: ["video ad", "video ads"],
  ad_copy: ["text ad", "text ads"],
  social_pack: ["social post", "social posts"],
  gbp_post: ["Google Business post", "Google Business posts"],
  seo_article: ["area article", "area articles"],
  none: ["no tracked content", "no tracked content"],
};

/** Which content kind a lead is credited to: the attributed asset's type, else a portfolio visit, else none. */
export function leadContentKind(assetType: AssetType | null, fromPortfolio: boolean): ContentKind {
  if (assetType) return assetType;
  return fromPortfolio ? "portfolio_visit" : "none";
}

const KIND_ORDER: Exclude<ContentKind, "portfolio_visit">[] = [
  "portfolio_page",
  "video",
  "ad_copy",
  "social_pack",
  "gbp_post",
  "seo_article",
  "none",
];

export type Breakdown = { kind: Exclude<ContentKind, "portfolio_visit">; label: string; count: number }[];

/** Counts per content kind (portfolio pages and portfolio visits merged), biggest first, untracked last. */
export function contentBreakdown(kinds: readonly ContentKind[]): Breakdown {
  const counts = new Map<Exclude<ContentKind, "portfolio_visit">, number>();
  for (const k of kinds) {
    const key = k === "portfolio_visit" ? "portfolio_page" : k;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count, label: KIND_LABEL[kind][count === 1 ? 0 : 1] }))
    .sort(
      (a, b) =>
        (a.kind === "none" ? 1 : 0) - (b.kind === "none" ? 1 : 0) ||
        b.count - a.count ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );
}

/** "5 enquiries from portfolio pages, 3 from video ads, 1 from a text ad" (untracked leads left out). */
export function breakdownSentence(b: Breakdown): string {
  const tracked = b.filter((x) => x.kind !== "none");
  if (!tracked.length) return "No enquiries traced to our content yet";
  return tracked
    .map((x, i) => {
      const what = x.count === 1 ? `a ${KIND_LABEL[x.kind][0]}` : x.label;
      const n = i === 0 ? `${x.count} ${x.count === 1 ? "enquiry" : "enquiries"}` : `${x.count}`;
      return `${n} from ${what}`;
    })
    .join(", ");
}

/** Short name for an attributed asset, e.g. "Reveal video · 9:16" or "Ad copy — craft angle". */
export function attributedAssetLabel(a: { type: AssetType; title: string; content: Record<string, unknown> }): string {
  if (a.type === "video") {
    const tpl = typeof a.content.template === "string" ? a.content.template : "";
    const ratio = typeof a.content.ratio === "string" ? a.content.ratio : "";
    const name = tpl ? `${tpl[0].toUpperCase()}${tpl.slice(1)} video` : "Video";
    return ratio ? `${name} · ${ratio}` : name;
  }
  return a.title;
}
