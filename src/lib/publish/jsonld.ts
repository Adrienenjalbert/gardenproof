/**
 * schema.org JSON-LD for portfolio pages and articles, as one @graph.
 *
 * Honesty rules (brief: "never invent ratings"): Review markup is emitted only when the homeowner gave a real
 * star rating, and no AggregateRating is emitted at all — we never hold a verifiable review count here.
 * The business is referenced by @id so the site's own LocalBusiness entity (theme/SEO plugin) can own details.
 */
import type { ArticleView, BusinessRef, PortfolioView, PublicImage } from "./view";

type Node = Record<string, unknown>;
export type JsonLdGraph = { "@context": "https://schema.org"; "@graph": Node[] };

const businessId = (b: BusinessRef) => `${b.url.replace(/\/$/, "")}/#business`;

function businessNode(b: BusinessRef): Node {
  return {
    "@type": "LocalBusiness",
    "@id": businessId(b),
    name: b.name,
    url: b.url,
    ...(b.logo ? { logo: b.logo, image: b.logo } : {}),
    ...(b.phone ? { telephone: b.phone } : {}),
  };
}

function breadcrumbs(items: { name: string; url: string }[]): Node {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: item.url })),
  };
}

function faqNode(faqs: { q: string; a: string }[], pageUrl: string): Node | null {
  if (!faqs.length) return null;
  return {
    "@type": "FAQPage",
    "@id": `${pageUrl}#faq`,
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

function imageNode(img: PublicImage, pageUrl: string): Node {
  return {
    "@type": "ImageObject",
    "@id": `${pageUrl}#image-${img.mediaId}`,
    contentUrl: img.src,
    url: img.src,
    description: img.alt,
    ...(img.caption ? { caption: img.caption } : {}),
    ...(img.width && img.height ? { width: img.width, height: img.height } : {}),
  };
}

const origin = (url: string) => new URL(url).origin;

export function buildPortfolioJsonLd(view: PortfolioView): JsonLdGraph {
  const pageUrl = view.canonicalUrl;
  const serviceId = `${pageUrl}#service`;
  const images = [view.hero, view.beforeAfter?.before, view.beforeAfter?.after, ...view.gallery]
    .filter((img): img is PublicImage => !!img)
    .filter((img, i, all) => all.findIndex((x) => x.mediaId === img.mediaId) === i);

  const service: Node = {
    "@type": "Service",
    "@id": serviceId,
    name: view.h1,
    serviceType: view.facts.service,
    description: view.summary,
    provider: { "@id": businessId(view.business) },
    url: pageUrl,
    ...(view.facts.area ? { areaServed: { "@type": "Place", name: view.facts.area } } : {}),
    ...(images.length ? { image: images.map((img) => ({ "@id": `${pageUrl}#image-${img.mediaId}` })) } : {}),
  };

  const t = view.testimonial;
  const review: Node | null =
    t && Number.isInteger(t.rating) && t.rating >= 1 && t.rating <= 5
      ? {
          "@type": "Review",
          itemReviewed: { "@id": serviceId },
          reviewRating: { "@type": "Rating", ratingValue: t.rating, bestRating: 5, worstRating: 1 },
          author: { "@type": "Person", name: t.attribution },
          reviewBody: t.quote,
        }
      : null;

  const graph: Node[] = [
    {
      "@type": "WebPage",
      "@id": pageUrl,
      url: pageUrl,
      name: view.seoTitle,
      description: view.metaDescription,
      about: { "@id": serviceId },
      ...(view.hero ? { primaryImageOfPage: { "@id": `${pageUrl}#image-${view.hero.mediaId}` } } : {}),
      ...(view.publishedAt ? { datePublished: view.publishedAt } : {}),
    },
    businessNode(view.business),
    service,
    ...images.map((img) => imageNode(img, pageUrl)),
    breadcrumbs([
      { name: "Home", url: `${origin(pageUrl)}/` },
      { name: "Projects", url: new URL("./..", pageUrl).toString() },
      { name: view.h1, url: pageUrl },
    ]),
  ];
  if (review) graph.push(review);
  const faq = faqNode(view.faqs, pageUrl);
  if (faq) graph.push(faq);
  return { "@context": "https://schema.org", "@graph": graph };
}

export function buildArticleJsonLd(view: ArticleView): JsonLdGraph {
  const pageUrl = view.canonicalUrl;
  const graph: Node[] = [
    {
      "@type": "Article",
      "@id": `${pageUrl}#article`,
      headline: view.h1,
      description: view.metaDescription,
      mainEntityOfPage: pageUrl,
      author: { "@id": businessId(view.business) },
      publisher: { "@id": businessId(view.business) },
      ...(view.publishedAt ? { datePublished: view.publishedAt } : {}),
    },
    businessNode(view.business),
    breadcrumbs([
      { name: "Home", url: `${origin(pageUrl)}/` },
      { name: "Advice", url: new URL("./..", pageUrl).toString() },
      { name: view.h1, url: pageUrl },
    ]),
  ];
  const faq = faqNode(view.faqs, pageUrl);
  if (faq) graph.push(faq);
  return { "@context": "https://schema.org", "@graph": graph };
}

/** Serialise for a <script type="application/ld+json"> tag: `<` is escaped so "</script>" can't break out. */
export function serializeJsonLd(graph: JsonLdGraph): string {
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}
