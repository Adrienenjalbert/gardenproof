/**
 * Pure mappers: render model → WordPress REST payloads.
 *
 * The GardenProof plugin renders the rich design from the `gp_content` meta (JSON). `content` is a plain,
 * semantic HTML fallback so the post still reads well if the plugin template is disabled, in feeds and in
 * the block editor.
 */
import { escapeHtml, safeHref } from "./html";
import { buildArticleJsonLd, buildPortfolioJsonLd, type JsonLdGraph } from "./jsonld";
import type { ArticleView, PortfolioView, PublicImage } from "./view";

/** Bump when the meta shape changes; the plugin checks it. */
export const GP_CONTENT_VERSION = 1;

export type GpContentMeta =
  | { version: number; type: "portfolio_page"; view: PortfolioView; jsonLd: JsonLdGraph }
  | { version: number; type: "seo_article"; view: ArticleView; jsonLd: JsonLdGraph };

export type WpPostPayload = {
  title: string;
  slug: string;
  status: "publish";
  content: string;
  excerpt: string;
  featured_media?: number;
  meta: { gp_content: string };
};

const p = (text: string) => `<p>${escapeHtml(text)}</p>`;

function link(text: string, url: string): string {
  const href = safeHref(url);
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>` : escapeHtml(text);
}

function figure(img: PublicImage): string {
  const size = img.width && img.height ? ` width="${img.width}" height="${img.height}"` : "";
  const caption = img.caption ? `<figcaption>${escapeHtml(img.caption)}</figcaption>` : "";
  return `<figure><img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}"${size} loading="lazy">${caption}</figure>`;
}

function faqsHtml(faqs: { q: string; a: string }[]): string[] {
  if (!faqs.length) return [];
  return ["<h2>Questions</h2>", ...faqs.map((f) => `<h3>${escapeHtml(f.q)}</h3>${p(f.a)}`)];
}

export function renderPortfolioBodyHtml(view: PortfolioView): string {
  const facts: [string, string | null][] = [
    ["Service", view.facts.service],
    ["Area", view.facts.area],
    ["Materials", view.facts.materials.join(", ") || null],
    ["Features", view.facts.features.join(", ") || null],
    ["Duration", view.facts.duration],
  ];
  const t = view.testimonial;
  return [
    p(view.summary),
    view.hero ? figure(view.hero) : "",
    `<ul>${facts
      .filter(([, v]) => v)
      .map(([k, v]) => `<li><strong>${k}:</strong> ${escapeHtml(v!)}</li>`)
      .join("")}</ul>`,
    ...(view.beforeAfter ? [figure(view.beforeAfter.before), figure(view.beforeAfter.after)] : []),
    "<h2>The brief</h2>",
    p(view.sections.brief),
    "<h2>The challenge</h2>",
    p(view.sections.challenge),
    "<h2>Our solution</h2>",
    p(view.sections.solution),
    "<h2>The result</h2>",
    p(view.sections.result),
    t
      ? `<blockquote><p>${escapeHtml(t.quote)}</p><cite>${escapeHtml(t.attribution)} · ${t.rating}/5</cite></blockquote>`
      : "",
    ...view.gallery.map(figure),
    ...faqsHtml(view.faqs),
    `<p>${link(view.cta.text, view.cta.url)}</p>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderArticleBodyHtml(view: ArticleView): string {
  const related = view.relatedProjects.length
    ? `<h2>Related projects</h2><ul>${view.relatedProjects.map((r) => `<li>${link(r.title, r.url)}</li>`).join("")}</ul>`
    : "";
  return [view.bodyHtml, ...faqsHtml(view.faqs), related, `<p>${link(view.cta.text, view.cta.url)}</p>`]
    .filter(Boolean)
    .join("\n");
}

export function toWpProjectPayload(view: PortfolioView): WpPostPayload {
  const meta: GpContentMeta = {
    version: GP_CONTENT_VERSION,
    type: "portfolio_page",
    view,
    jsonLd: buildPortfolioJsonLd(view),
  };
  return {
    title: view.h1,
    slug: view.slug,
    status: "publish",
    content: renderPortfolioBodyHtml(view),
    excerpt: view.summary,
    ...(view.hero?.wpId ? { featured_media: view.hero.wpId } : {}),
    meta: { gp_content: JSON.stringify(meta) },
  };
}

export function toWpArticlePayload(view: ArticleView): WpPostPayload {
  const meta: GpContentMeta = { version: GP_CONTENT_VERSION, type: "seo_article", view, jsonLd: buildArticleJsonLd(view) };
  return {
    title: view.h1,
    slug: view.slug,
    status: "publish",
    content: renderArticleBodyHtml(view),
    excerpt: view.metaDescription,
    meta: { gp_content: JSON.stringify(meta) },
  };
}

/** WordPress attachment slug we assign to an uploaded media row; used to find it again (idempotent uploads). */
export function wpMediaSlug(mediaId: string): string {
  return `gp-${mediaId.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;
}
