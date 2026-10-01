/**
 * Structured editing for asset content. Each asset type exposes its commonly edited text fields as specs;
 * the editor reads/writes them by path on a copy of the content, and the whole object is validated
 * against ASSET_CONTENT_SCHEMAS on save. Anything not listed is still editable via "advanced JSON".
 */
import { ASSET_CONTENT_SCHEMAS, type AssetType } from "@/lib/domain";
import { AD_LIMITS } from "./logic";

export type FieldSpec = {
  path: string[];
  label: string;
  /** text = single line, textarea = paragraph, list = one string per line, select = fixed options. */
  kind: "text" | "textarea" | "list" | "select";
  max?: number;
  /** Limit applies to word count instead of characters (Meta on-video hooks). */
  maxWords?: number;
  options?: readonly string[];
  hint?: string;
  /** Empty input is stored as null (schema allows null). */
  nullable?: boolean;
};

export const FIELD_SPECS: Record<AssetType, FieldSpec[]> = {
  portfolio_page: [
    { path: ["seoTitle"], label: "SEO title", kind: "text", max: 65 },
    { path: ["metaDescription"], label: "Meta description", kind: "textarea", max: 160 },
    { path: ["h1"], label: "Page heading (H1)", kind: "text" },
    { path: ["summary"], label: "Summary", kind: "textarea", hint: "2–3 factual sentences AI answer engines can quote." },
    { path: ["sections", "brief"], label: "The brief", kind: "textarea" },
    { path: ["sections", "challenge"], label: "The challenge", kind: "textarea" },
    { path: ["sections", "solution"], label: "What we did", kind: "textarea" },
    { path: ["sections", "result"], label: "The result", kind: "textarea" },
  ],
  seo_article: [
    { path: ["seoTitle"], label: "SEO title", kind: "text", max: 65 },
    { path: ["metaDescription"], label: "Meta description", kind: "textarea", max: 160 },
    { path: ["h1"], label: "Heading (H1)", kind: "text" },
    { path: ["targetKeyword"], label: "Target keyword", kind: "text" },
    { path: ["bodyMarkdown"], label: "Body (Markdown)", kind: "textarea" },
  ],
  ad_copy: [
    { path: ["angle"], label: "Angle", kind: "text" },
    { path: ["meta", "hooks"], label: "Meta · on-video hooks", kind: "list", maxWords: AD_LIMITS.metaHookWords },
    { path: ["meta", "primaryTexts"], label: "Meta · primary texts", kind: "list", max: AD_LIMITS.metaPrimaryText },
    { path: ["meta", "headlines"], label: "Meta · headlines", kind: "list", max: AD_LIMITS.metaHeadline },
    { path: ["pmax", "headlines"], label: "PMax · headlines", kind: "list", max: AD_LIMITS.pmaxHeadline },
    { path: ["pmax", "longHeadlines"], label: "PMax · long headlines", kind: "list", max: AD_LIMITS.pmaxLongHeadline },
    { path: ["pmax", "descriptions"], label: "PMax · descriptions", kind: "list", max: AD_LIMITS.pmaxDescription },
  ],
  social_pack: [
    { path: ["captions"], label: "Caption variants", kind: "list", hint: "One caption per line." },
    { path: ["hashtags"], label: "Hashtags", kind: "list", hint: "One per line, without spaces." },
    { path: ["reelCoverText"], label: "Reel cover text", kind: "text", nullable: true },
  ],
  gbp_post: [
    { path: ["text"], label: "Post text", kind: "textarea", max: 1500 },
    { path: ["ctaType"], label: "Button", kind: "select", options: ["BOOK", "LEARN_MORE", "CALL"] },
    { path: ["ctaUrl"], label: "Button link", kind: "text", nullable: true },
  ],
  video: [{ path: ["hook"], label: "On-screen hook", kind: "text", maxWords: AD_LIMITS.metaHookWords }],
};

export function getAt(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Immutable set-by-path; creates intermediate objects as needed. */
export function setAt<T>(obj: T, path: readonly string[], value: unknown): T {
  if (!path.length) return value as T;
  const [head, ...rest] = path;
  const base = obj !== null && typeof obj === "object" ? (obj as Record<string, unknown>) : {};
  return { ...base, [head]: setAt(base[head], rest, value) } as T;
}

/** Value shown in a form control for a field. */
export function fieldToText(spec: FieldSpec, content: unknown): string {
  const v = getAt(content, spec.path);
  if (spec.kind === "list") return Array.isArray(v) ? v.map(String).join("\n") : "";
  return v === null || v === undefined ? "" : String(v);
}

/** Parse a form control's text back into the content value (lists split per line; empty nullable → null). */
export function textToField(spec: FieldSpec, text: string): unknown {
  if (spec.kind === "list") {
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (spec.nullable && text.trim() === "") return null;
  return text;
}

export type ContentValidation = { ok: true; content: Record<string, unknown> } | { ok: false; errors: string[] };

/** Validate content for an asset type and return readable, path-prefixed errors. */
export function validateAssetContent(type: AssetType, content: unknown): ContentValidation {
  const res = ASSET_CONTENT_SCHEMAS[type].safeParse(content);
  if (res.success) return { ok: true, content: res.data as Record<string, unknown> };
  return {
    ok: false,
    errors: res.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "content"}: ${i.message}`),
  };
}
