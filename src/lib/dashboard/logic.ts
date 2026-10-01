/**
 * Pure dashboard logic (no DB, no React) so it can be unit-tested and shared by server and client code.
 */
import type { MediaStage } from "@/lib/domain";

export type Check = { id: string; ok: boolean; message: string };

// ---------------------------------------------------------------------------
// Approval guards
// ---------------------------------------------------------------------------

/** Failed consent checks. Any of these makes approval impossible: consent is non-negotiable. */
export function consentBlockers(checks: readonly Check[]): Check[] {
  return checks.filter((c) => c.id.startsWith("consent") && !c.ok);
}

/**
 * Failed checks that make even a manual approval impossible: consent (non-negotiable) and privacy (address,
 * surname, postcode in public copy). The publisher holds these too; refusing at approval keeps the status honest.
 */
export function approvalBlockers(checks: readonly Check[]): Check[] {
  return checks.filter((c) => /^(consent|privacy)/.test(c.id) && !c.ok);
}

/** Bulk approve is only offered for assets whose automated checks all pass. */
export function allChecksPass(checks: readonly Check[]): boolean {
  return checks.every((c) => c.ok);
}

/**
 * Why bulk approve must skip an asset, or null when it may be approved in bulk. ANY failing check skips it
 * (which-rating, thin input, limits…): bulk approval is for the obviously clean items only.
 */
export function bulkSkipReason(a: { status: string; checks: readonly Check[] }): string | null {
  if (a.status !== "in_review") return `already ${a.status.replace("_", " ")}`;
  const failed = a.checks.filter((c) => !c.ok);
  if (!failed.length) return null;
  return failed.map((c) => c.message || c.id).join("; ");
}

export function checkSummary(checks: readonly Check[]): { passed: number; failed: number; total: number } {
  const failed = checks.filter((c) => !c.ok).length;
  return { passed: checks.length - failed, failed, total: checks.length };
}

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

export function pluralise(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export type HeadlineCounts = {
  jobsThisMonth: number;
  assetsInReview: number;
  repliesPending: number;
  heldMessages: number;
};

/** Plain-English overview headline, e.g. "3 jobs captured this month · 2 assets waiting for you". */
export function overviewHeadline(c: HeadlineCounts): string[] {
  const parts = [`${pluralise(c.jobsThisMonth, "job")} captured this month`];
  parts.push(
    c.assetsInReview ? `${pluralise(c.assetsInReview, "asset")} waiting for you` : "nothing waiting for review",
  );
  if (c.repliesPending) parts.push(`${pluralise(c.repliesPending, "homeowner reply", "homeowner replies")} pending`);
  if (c.heldMessages) parts.push(`${pluralise(c.heldMessages, "message")} held for approval`);
  return parts;
}

/** Relative, human time ("3 days ago", "in 2 hours") in British English. */
export function timeAgo(date: Date | null | undefined, now = new Date()): string {
  if (!date) return "—";
  const diff = now.getTime() - date.getTime();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [365 * 864e5, "year"],
    [30 * 864e5, "month"],
    [7 * 864e5, "week"],
    [864e5, "day"],
    [36e5, "hour"],
    [6e4, "minute"],
  ];
  for (const [ms, unit] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return diff >= 0 ? `${pluralise(n, unit)} ago` : `in ${pluralise(n, unit)}`;
    }
  }
  return "just now";
}

export function formatDate(date: Date | null | undefined, withTime = false): string {
  if (!date) return "—";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Europe/London",
  });
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Below this quality score a photo is flagged in "Needs you". */
export const LOW_QUALITY_THRESHOLD = 0.6;

/** Turn quality notes ("needs blur; slightly dark") + score into short badges. */
export function qualityFlags(m: { qualityScore: number | null; qualityNotes: string | null }): string[] {
  const flags = (m.qualityNotes ?? "")
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (m.qualityScore !== null && m.qualityScore < LOW_QUALITY_THRESHOLD && !flags.length) flags.push("low quality");
  return flags;
}

export function hasQualityIssue(m: { qualityScore: number | null; qualityNotes: string | null }): boolean {
  return qualityFlags(m).length > 0;
}

export function groupByStage<T extends { stage: MediaStage }>(items: readonly T[]): Record<MediaStage, T[]> {
  const out: Record<MediaStage, T[]> = { before: [], progress: [], after: [] };
  for (const m of items) out[m.stage].push(m);
  return out;
}

/** Best cover image for a job card: hero after → any after → hero before → anything. */
export function pickCover<T extends { stage: MediaStage; isHero: boolean; kind: string }>(items: readonly T[]): T | null {
  const images = items.filter((m) => m.kind === "image");
  return (
    images.find((m) => m.stage === "after" && m.isHero) ??
    images.find((m) => m.stage === "after") ??
    images.find((m) => m.isHero) ??
    images.find((m) => m.stage === "before") ??
    images[0] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Ad copy limits (platform maxima / recommendations)
// ---------------------------------------------------------------------------

export const AD_LIMITS = {
  metaHookWords: 6,
  metaPrimaryText: 125,
  metaHeadline: 40,
  pmaxHeadline: 30,
  pmaxLongHeadline: 90,
  pmaxDescription: 90,
} as const;

export type LimitState = "ok" | "near" | "over";

/** Counter state for a length vs its limit ("near" from 90%). */
export function limitState(length: number, max: number): LimitState {
  if (length > max) return "over";
  if (length >= Math.ceil(max * 0.9)) return "near";
  return "ok";
}

export function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export type LeadLike = {
  source: string | null;
  landingPage: string | null;
  projectSlug: string | null;
  assetId: string | null;
};

/** A lead counts as "from a portfolio page" when it saw a project page before enquiring. */
export function isFromPortfolio(l: LeadLike): boolean {
  return Boolean(l.projectSlug || l.assetId || /\/(projects|portfolio|preview)\//.test(l.landingPage ?? ""));
}

export function leadSummary(leads: readonly LeadLike[]): {
  total: number;
  fromPortfolio: number;
  bySource: { source: string; count: number }[];
} {
  const counts = new Map<string, number>();
  for (const l of leads) {
    const key = (l.source || "direct").toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    total: leads.length,
    fromPortfolio: leads.filter(isFromPortfolio).length,
    bySource: [...counts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
  };
}

// ---------------------------------------------------------------------------
// Asset excerpts (one-line summary for queues)
// ---------------------------------------------------------------------------

function firstString(v: unknown): string | null {
  return Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;
}

/** Best one-line description of an asset's content, tolerant of partial/invalid content. */
export function assetExcerpt(type: string, content: Record<string, unknown>): string {
  const c = content as Record<string, unknown> & { meta?: { primaryTexts?: unknown } };
  const pick = (() => {
    switch (type) {
      case "portfolio_page":
        return c.summary;
      case "seo_article":
        return c.metaDescription ?? c.h1;
      case "ad_copy":
        return firstString(c.meta?.primaryTexts);
      case "social_pack":
        return firstString(c.captions);
      case "gbp_post":
        return c.text;
      case "video":
        return c.hook;
      default:
        return null;
    }
  })();
  const text = typeof pick === "string" ? pick.replace(/\s+/g, " ").trim() : "";
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}
