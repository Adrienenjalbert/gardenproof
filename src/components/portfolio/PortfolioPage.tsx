/**
 * The premium case-study page for one finished job. Rendered from a PortfolioView, so the Next preview and
 * the WordPress plugin template (wordpress/gardenproof-portfolio/templates) show the same page.
 */
import { buildPortfolioJsonLd } from "@/lib/publish/jsonld";
import type { PortfolioView } from "@/lib/publish/view";
import { BeforeAfter } from "./BeforeAfter";
import { JsonLd, PreviewBanner, SiteFooter, SiteHeader } from "./chrome";
import { container, CtaBand, eyebrow, Faqs, FactsRail, Gallery, Hero, MoreLinks, Story, Testimonial } from "./sections";

export function PortfolioPage({ view, preview }: { view: PortfolioView; preview?: { status: string; version: number } }) {
  return (
    <div className="flex flex-1 flex-col bg-background" data-gp-project={view.slug}>
      {preview ? <PreviewBanner {...preview} /> : null}
      <SiteHeader business={view.business} cta={view.cta} />
      <main className="flex-1">
        <article>
          <Hero view={view} />

          <section className={`${container} grid gap-12 pt-16 pb-12 sm:pt-24 sm:pb-16 lg:grid-cols-12 lg:gap-8`}>
            <div className="lg:col-span-7">
              <p className={`${eyebrow} text-muted`}>The project</p>
              <p className="mt-5 font-display text-[1.45rem] leading-[1.5] text-olive-dark sm:text-[1.8rem]">
                {view.summary}
              </p>
            </div>
            <aside className="lg:col-span-4 lg:col-start-9" aria-label="Project facts">
              <FactsRail view={view} />
            </aside>
          </section>

          {view.beforeAfter ? (
            <section aria-labelledby="ba-title" className={`${container}`}>
              <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <h2 id="ba-title" className="font-display text-3xl text-olive-dark">
                  Before &amp; after
                </h2>
                <p className="text-sm text-muted">Drag across the photo, or use the arrow keys, to compare.</p>
              </div>
              <BeforeAfter before={view.beforeAfter.before} after={view.beforeAfter.after} />
            </section>
          ) : null}

          <Story sections={view.sections} />
          {view.testimonial ? <Testimonial testimonial={view.testimonial} /> : null}
          <Gallery images={view.gallery} />
          <Faqs faqs={view.faqs} />
          <MoreLinks links={view.internalLinks} />
        </article>
        <CtaBand cta={view.cta} area={view.facts.area} />
      </main>
      <SiteFooter business={view.business} />
      <JsonLd graph={buildPortfolioJsonLd(view)} />
    </div>
  );
}
