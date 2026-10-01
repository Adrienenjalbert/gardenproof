/* eslint-disable @next/next/no-img-element -- media is served by our own route and mirrored in WordPress markup */
/** Presentational sections of the case-study page. Pure server components, no data access. */
import type { CSSProperties } from "react";
import type { PortfolioView, PublicImage } from "@/lib/publish/view";

export const container = "mx-auto w-full max-w-6xl px-5 sm:px-8";

/**
 * Never stretch a photo beyond its own pixels (a 720 px phone still blown up to 1440 px looks soft): cap the
 * rendered width at the source width and keep its aspect ratio; the olive backdrop fills any side space.
 * Unknown dimensions fall back to a fixed-height crop.
 */
export function nativeSizeStyle(
  img: Pick<PublicImage, "width" | "height">,
  fallback: "h-fixed" | "none" = "none",
): CSSProperties | undefined {
  if (img.width && img.height) return { maxWidth: `${img.width}px`, aspectRatio: `${img.width} / ${img.height}` };
  return fallback === "h-fixed" ? { height: "min(82vh, 780px)" } : undefined;
}
export const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.22em]";

export function Hero({ view }: { view: PortfolioView }) {
  const kicker = [view.facts.service, view.facts.area].filter(Boolean).join(" · ");
  return (
    <section className="relative isolate overflow-hidden bg-olive-dark">
      {view.hero ? (
        <img
          src={view.hero.src}
          alt={view.hero.alt}
          width={view.hero.width ?? undefined}
          height={view.hero.height ?? undefined}
          sizes="100vw"
          className="mx-auto block max-h-[min(82vh,780px)] min-h-[460px] w-full object-cover"
          style={nativeSizeStyle(view.hero, "h-fixed")}
          fetchPriority="high"
        />
      ) : (
        <div className="h-[46vh] min-h-[360px]" />
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(to_top,rgba(22,24,15,0.82)_0%,rgba(22,24,15,0.35)_38%,rgba(22,24,15,0)_65%)]"
      />
      <div className="absolute inset-x-0 bottom-0">
        <div className={`${container} pb-10 sm:pb-16`}>
          <nav aria-label="Breadcrumb" className="mb-5 text-xs text-white/70">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <a href={view.business.url} className="hover:text-white">
                  Home
                </a>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <a href="/portfolio" className="hover:text-white">
                  Projects
                </a>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="truncate text-white/90">
                {view.facts.area ?? view.h1}
              </li>
            </ol>
          </nav>
          {kicker ? <p className={`${eyebrow} mb-4 text-white/80`}>{kicker}</p> : null}
          <h1 className="max-w-4xl font-display text-[2.1rem] leading-[1.08] text-white sm:text-5xl lg:text-[3.6rem]">
            {view.h1}
          </h1>
        </div>
      </div>
    </section>
  );
}

export function Stars({ rating, className = "" }: { rating: number; className?: string }) {
  return (
    <span role="img" aria-label={`Rated ${rating} out of 5`} className={`inline-flex gap-1 ${className}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
          <path
            d="M10 1.8l2.47 5.2 5.68.66-4.2 3.9 1.12 5.62L10 14.4l-5.07 2.78 1.12-5.62-4.2-3.9 5.68-.66z"
            fill={i < rating ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      ))}
    </span>
  );
}

export function FactsRail({ view }: { view: PortfolioView }) {
  const rows: [string, string | string[] | null][] = [
    ["Service", view.facts.service],
    ["Area", view.facts.area],
    ["Materials", view.facts.materials],
    ["Features", view.facts.features],
    ["Duration", view.facts.duration],
  ];
  return (
    <div className="border-t-2 border-olive pt-6">
      <h2 className={`${eyebrow} text-muted`}>Project facts</h2>
      <dl className="mt-4 divide-y divide-line">
        {rows
          .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : !!v))
          .map(([label, value]) => (
            <div key={label} className="grid grid-cols-[6.5rem_1fr] gap-4 py-3.5 text-[15px]">
              <dt className="pt-px text-sm text-muted">{label}</dt>
              <dd className="text-foreground">
                {Array.isArray(value) ? (
                  <ul className="space-y-1">
                    {value.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        {view.testimonial ? (
          <div className="grid grid-cols-[6.5rem_1fr] gap-4 py-3.5 text-[15px]">
            <dt className="pt-px text-sm text-muted">Homeowner</dt>
            <dd className="flex items-center gap-2 text-olive">
              <Stars rating={view.testimonial.rating} />
              <span className="text-sm text-foreground">{view.testimonial.rating}/5</span>
            </dd>
          </div>
        ) : null}
      </dl>
      <a
        href={view.cta.url}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-olive px-6 py-4 text-[15px] font-medium text-white transition-colors hover:bg-olive-dark focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-olive"
      >
        {view.cta.text}
        <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}

const STORY: { key: keyof PortfolioView["sections"]; title: string }[] = [
  { key: "brief", title: "The brief" },
  { key: "challenge", title: "The challenge" },
  { key: "solution", title: "Our solution" },
  { key: "result", title: "The result" },
];

export function Story({ sections }: { sections: PortfolioView["sections"] }) {
  return (
    <section aria-label="The project story" className={`${container} pt-12 pb-16 sm:pt-16 sm:pb-24`}>
      <ol className="border-t border-line">
        {STORY.filter((s) => sections[s.key]?.trim()).map((s, i) => (
          <li key={s.key} className="grid gap-3 border-b border-line py-10 sm:py-12 lg:grid-cols-12 lg:gap-8">
            <div className="flex items-baseline gap-4 lg:col-span-4">
              <span className="font-display text-sm text-muted tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <h2 className="font-display text-2xl text-olive-dark sm:text-[1.7rem]">{s.title}</h2>
            </div>
            <p className="max-w-[62ch] text-[17px] leading-[1.75] text-foreground/85 lg:col-span-7 lg:col-start-6">
              {sections[s.key]}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Testimonial({ testimonial }: { testimonial: NonNullable<PortfolioView["testimonial"]> }) {
  return (
    <section aria-label="What the homeowner said" className="bg-olive-50">
      <figure className={`${container} flex max-w-4xl flex-col items-center py-20 text-center sm:py-28`}>
        <Stars rating={testimonial.rating} className="text-olive [&_svg]:h-5 [&_svg]:w-5" />
        <blockquote className="mt-8 font-display text-[1.6rem] leading-[1.4] text-olive-dark sm:text-[2.15rem]">
          <p>
            <span aria-hidden="true">“</span>
            {testimonial.quote}
            <span aria-hidden="true">”</span>
          </p>
        </blockquote>
        <figcaption className="mt-8 text-sm text-muted">
          <span className="font-semibold text-foreground">{testimonial.attribution}</span>
          <span className="mx-2" aria-hidden="true">
            ·
          </span>
          Homeowner, {testimonial.rating} out of 5
        </figcaption>
      </figure>
    </section>
  );
}

function Figure({ img, className = "" }: { img: PublicImage; className?: string }) {
  return (
    <figure className={`m-0 ${className}`}>
      <img
        src={img.src}
        alt={img.alt}
        width={img.width ?? undefined}
        height={img.height ?? undefined}
        loading="lazy"
        decoding="async"
        sizes="(min-width: 640px) 50vw, 100vw"
        className="mx-auto block h-auto w-full bg-olive-100 object-cover"
        style={nativeSizeStyle(img)}
      />
      {img.caption ? <figcaption className="mt-3 text-sm text-muted">{img.caption}</figcaption> : null}
    </figure>
  );
}

export function Gallery({ images }: { images: PublicImage[] }) {
  if (!images.length) return null;
  return (
    <section aria-labelledby="gallery-title" className={`${container} py-16 sm:py-24`}>
      <h2 id="gallery-title" className={`${eyebrow} mb-8 text-muted`}>
        Gallery
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
        {images.map((img, i) => (
          <Figure key={img.mediaId} img={img} className={i === 0 && images.length % 2 === 1 ? "sm:col-span-2" : ""} />
        ))}
      </div>
    </section>
  );
}

export function Faqs({ faqs, title = "Questions about this project" }: { faqs: { q: string; a: string }[]; title?: string }) {
  if (!faqs.length) return null;
  return (
    <section aria-labelledby="faq-title" className={`${container} py-16 sm:py-24`}>
      <div className="grid gap-8 lg:grid-cols-12">
        <h2 id="faq-title" className="font-display text-3xl text-olive-dark lg:col-span-4">
          {title}
        </h2>
        <div className="border-t border-line lg:col-span-7 lg:col-start-6">
          {faqs.map((f) => (
            <details key={f.q} className="group border-b border-line">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 text-[17px] font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
                {f.q}
                <span
                  aria-hidden="true"
                  className="mt-0.5 text-2xl leading-none font-light text-olive transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="max-w-[62ch] pb-6 text-[16px] leading-[1.75] text-foreground/80">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MoreLinks({ links }: { links: { text: string; url: string }[] }) {
  if (!links.length) return null;
  return (
    <nav aria-labelledby="more-title" className={`${container} pb-16 sm:pb-24`}>
      <h2 id="more-title" className={`${eyebrow} mb-4 text-muted`}>
        Keep exploring
      </h2>
      <ul className="border-t border-line">
        {links.map((l) => (
          <li key={l.url + l.text} className="border-b border-line">
            <a
              href={l.url}
              className="group flex items-center justify-between py-5 font-display text-xl text-olive-dark hover:text-olive"
            >
              {l.text}
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function CtaBand({
  cta,
  area,
  heading = "Planning a garden like this one?",
  body = "Talk it through with the team who designed and built it.",
}: {
  cta: { text: string; url: string };
  area: string | null;
  heading?: string;
  body?: string;
}) {
  return (
    <section aria-labelledby="cta-title" className="border-t border-line bg-white">
      <div className={`${container} flex flex-col items-start gap-8 py-20 sm:py-24 lg:flex-row lg:items-end lg:justify-between`}>
        <div className="max-w-2xl">
          <p className={`${eyebrow} text-muted`}>{area ? `A finished garden in ${area}` : "Real work, finished"}</p>
          <h2 id="cta-title" className="mt-4 font-display text-3xl leading-tight text-olive-dark sm:text-[2.6rem]">
            {heading}
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-foreground/75">
            {body}
          </p>
        </div>
        <a
          href={cta.url}
          className="inline-flex shrink-0 items-center gap-3 rounded-full bg-olive px-8 py-4 text-base font-medium text-white transition-colors hover:bg-olive-dark focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-olive"
        >
          {cta.text}
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>
  );
}
