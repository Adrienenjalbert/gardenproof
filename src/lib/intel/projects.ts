/**
 * Projects from the business's portfolio: one per project page (title, category, area, summary, photos), topped up
 * from a gallery page by grouping photos whose file names name a place or a kind of work. Customer names are never
 * used (portfolio pages often list "Garden Owner: …" and galleries name files after clients).
 */
import { ancestors, findAll, parseHtml, type HtmlEl } from "./html";
import { originalImageCandidates } from "./images";
import { collapse, labelFromSlug } from "./text";
import { absolutise, isSameSite } from "./url";

export type ProjectImageRef = { url: string; alt: string | null; declaredWidth: number | null };
export type ProjectDraft = { title: string; url: string; category: string | null; area: string | null; summary: string | null; images: ProjectImageRef[] };

const NOT_PHOTO = /logo|icon|badge|avatar|placeholder|spinner|sprite|favicon|banner-ad|\.svg(\?|$)|\.gif(\?|$)/i;

/** Largest candidate from srcset ("a.jpg 640w, b.jpg 1280w"). */
function largestFromSrcset(srcset: string | undefined, base: string): string | null {
  if (!srcset) return null;
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(",")) {
    const [u, d] = part.trim().split(/\s+/);
    const w = parseInt(d ?? "", 10) || 0;
    const abs = absolutise(u, base);
    if (abs && (!best || w > best.w)) best = { url: abs, w };
  }
  return best?.url ?? null;
}

/** Content photos on a page: no chrome (header/nav/footer), no logos/badges, no images shared with other pages. */
export function contentImages(rawHtml: string, pageUrl: string, opts: { exclude?: Set<string>; siteUrl: string; max?: number }): ProjectImageRef[] {
  const root = parseHtml(rawHtml);
  const seen = new Set<string>();
  const out: ProjectImageRef[] = [];
  for (const img of findAll(root, (e) => e.tag === "img")) {
    if (ancestors(img).some((a: HtmlEl) => a.tag === "header" || a.tag === "nav" || a.tag === "footer" || a.tag === "aside")) continue;
    const src = largestFromSrcset(img.attrs.srcset ?? img.attrs["data-srcset"], pageUrl) ?? absolutise(img.attrs["data-src"] ?? img.attrs["data-lazy-src"] ?? img.attrs.src, pageUrl);
    if (!src || !/^https?:/.test(src) || NOT_PHOTO.test(src) || !isSameSite(src, opts.siteUrl)) continue;
    const orig = originalImageCandidates(src)[0];
    if (seen.has(orig) || opts.exclude?.has(orig)) continue;
    const w = parseInt(img.attrs.width ?? "", 10) || null;
    const h = parseInt(img.attrs.height ?? "", 10) || null;
    // Thumbnails of real photos are fine (we fetch the original); tiny images are decoration.
    if ((w !== null && w < 300 && orig === src) || (h !== null && h < 200 && orig === src)) continue;
    if (w !== null && w < 150) continue;
    seen.add(orig);
    out.push({ url: src, alt: img.attrs.alt?.trim() || null, declaredWidth: w });
    if (out.length >= (opts.max ?? 40)) break;
  }
  return out;
}

const NOT_PROJECT_PATH = /\/(category|tag|author|page|feed|wp-json|wp-content|privacy|cookie|terms|sitemap|cart|checkout|login|careers?|vacancies|jobs)(\/|$)|\.(pdf|jpe?g|png|webp|xml)$/i;

/**
 * Project pages linked from a portfolio / case-studies index: same-site links in the page body (not the header,
 * menu or footer), excluding pages we already know are something else (services, about, contact…).
 */
export function projectLinksFromIndex(rawHtml: string, pageUrl: string, siteUrl: string, exclude: Set<string>, max = 12): string[] {
  const root = parseHtml(rawHtml);
  const out: string[] = [];
  const seen = new Set<string>();
  const self = pageUrl.replace(/[#?].*$/, "").replace(/\/+$/, "");
  for (const a of findAll(root, (e) => e.tag === "a" && Boolean(e.attrs.href))) {
    if (ancestors(a).some((p: HtmlEl) => p.tag === "header" || p.tag === "nav" || p.tag === "footer" || p.tag === "aside")) continue;
    const href = absolutise(a.attrs.href, pageUrl)?.replace(/[#?].*$/, "");
    if (!href || !isSameSite(href, siteUrl) || NOT_PROJECT_PATH.test(new URL(href).pathname)) continue;
    const key = href.replace(/\/+$/, "");
    if (key === self || key === siteUrl.replace(/\/+$/, "") || seen.has(key) || exclude.has(key)) continue;
    seen.add(key);
    out.push(href);
    if (out.length >= max) break;
  }
  return out;
}

/** "Location\n\nWimbledon" / "**Location:** Wimbledon" style fields in project markdown. */
export function markdownField(md: string, label: string): string | null {
  const re = new RegExp(`(?:^|\\n)\\s*\\**${label}\\**\\s*:?\\**\\s*(?:\\n\\s*)*([^\\n]{2,80})`, "i");
  const m = re.exec(md);
  if (!m) return null;
  const v = collapse(m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_#]/g, ""));
  if (!v || /^(garden owner|location|category|features|date)$/i.test(v) || /https?:|\]\(/.test(v)) return null;
  return v.replace(/\s*\/\s*/g, " / ");
}

const CLIENT_LABELS = /\b(garden owner|client|customer|homeowner)\b/i;

/** Project summary: the first real paragraph after the title, never a client field. */
export function summaryFrom(md: string, title: string): string | null {
  const start = md.indexOf(title);
  const body = start >= 0 ? md.slice(start + title.length) : md;
  for (const raw of body.split(/\n{2,}/)) {
    const p = collapse(raw.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_#>]+/g, ""));
    if (p.length < 80 || CLIENT_LABELS.test(p) || /^[-•]/.test(p) || /cookie|©/i.test(p)) continue;
    return p.replace(/^Before:\s*/i, "").slice(0, 600);
  }
  return null;
}

/** "Driveway Transformation in New Malden" → "New Malden" (a capitalised place after "in", at the end). */
export function placeInTitle(title: string): string | null {
  const m = /\bin ((?:[A-Z][a-z']+)(?:[ -](?:upon|on|under|[A-Z][a-z']+)){0,3})\s*$/.exec(title.trim());
  return m ? m[1] : null;
}

/** Match a known area name in text (longest first). */
export function areaIn(text: string, areas: string[]): string | null {
  const lc = text.toLowerCase();
  for (const a of [...areas].sort((x, y) => y.length - x.length)) {
    if (new RegExp(`\\b${a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lc)) return a;
  }
  return null;
}

const CATEGORY_WORDS: [RegExp, string][] = [
  [/garden design|design (and|&) build|full garden/i, "Garden design"],
  [/maintenance|tidy|hedge|lawn care/i, "Garden maintenance"],
  [/patio|paving|porcelain|sandstone/i, "Patios & paving"],
  [/decking|deck\b/i, "Decking"],
  [/fenc/i, "Fencing"],
  [/turf|lawn/i, "Lawns & turfing"],
  [/plant/i, "Planting"],
  [/pond|water feature/i, "Water features"],
  [/landscap/i, "Landscaping"],
];
export function categoryFrom(text: string): string | null {
  for (const [re, label] of CATEGORY_WORDS) if (re.test(text)) return label;
  return null;
}

/** Build a project from a portfolio page (markdown + raw HTML). */
export function projectFromPage(page: { url: string; markdown: string; rawHtml: string; title?: string | null }, ctx: { siteUrl: string; businessName: string; areas: string[]; exclude: Set<string> }): ProjectDraft | null {
  const metaTitle = (page.title ?? "").replace(new RegExp(`\\s*[-|–]\\s*${ctx.businessName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$`, "i"), "").trim();
  const h = /(?:^|\n)#{1,2}\s+([^\n]{3,120})/.exec(page.markdown.replace(/^[\s\S]*?\n(?=#{1,2}\s)/, "\n"));
  const title = collapse(metaTitle || h?.[1] || labelFromSlug(new URL(page.url).pathname.split("/").filter(Boolean).pop() ?? ""));
  if (!title) return null;
  const images = contentImages(page.rawHtml, page.url, { siteUrl: ctx.siteUrl, exclude: ctx.exclude, max: 12 });
  if (!images.length) return null;
  // Structured fields ("Location", "Category") are read only below the title: the site header has "Location:" too.
  const firstHeading = page.markdown.search(/(^|\n)#{1,3}\s/);
  const body = firstHeading >= 0 ? page.markdown.slice(firstHeading) : page.markdown;
  const category = markdownField(body, "Category") ?? categoryFrom(`${title} ${page.url}`);
  const area = markdownField(body, "Location") ?? areaIn(`${title} ${page.url}`, ctx.areas) ?? placeInTitle(title);
  return { title, url: page.url, category, area, summary: summaryFrom(page.markdown, title), images };
}

/**
 * Gallery top-up: group photos by file-name stem ("Wandsworth-3-640x450.jpg" → "wandsworth"), keeping only stems
 * that name a known area or a kind of work (never people).
 */
export function projectsFromGallery(images: ProjectImageRef[], ctx: { galleryUrl: string; areas: string[] }): ProjectDraft[] {
  const groups = new Map<string, ProjectImageRef[]>();
  for (const img of images) {
    const file = decodeURIComponent(originalImageCandidates(img.url)[0].split("/").pop() ?? "");
    const stem = file.replace(/\.[a-z0-9]+$/i, "").replace(/([-_ ]\d+)+$/g, "").replace(/[-_]+/g, " ").trim().toLowerCase();
    if (!stem) continue;
    groups.set(stem, [...(groups.get(stem) ?? []), img]);
  }
  const out: ProjectDraft[] = [];
  for (const [stem, imgs] of groups) {
    const area = areaIn(stem, ctx.areas);
    const category = categoryFrom(stem);
    if ((!area && !category) || imgs.length < 2) continue;
    const title = area ? `${area} garden${category ? ` – ${category.toLowerCase()}` : ""}` : category!;
    out.push({ title, url: ctx.galleryUrl, category, area, summary: null, images: imgs.slice(0, 6) });
  }
  return out;
}
