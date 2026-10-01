/** Long-form advice article (seo_article). Body HTML comes from the safe markdown renderer. */
import { buildArticleJsonLd } from "@/lib/publish/jsonld";
import type { ArticleView } from "@/lib/publish/view";
import { JsonLd, PreviewBanner, SiteFooter, SiteHeader } from "./chrome";
import { container, CtaBand, eyebrow, Faqs, MoreLinks } from "./sections";

/** Typography for the rendered markdown (no typography plugin available). */
const prose = [
  "text-[17px] leading-[1.8] text-foreground/85",
  "[&_h2]:mt-14 [&_h2]:mb-4 [&_h2]:font-display [&_h2]:text-[1.7rem] [&_h2]:leading-snug [&_h2]:text-olive-dark",
  "[&_h3]:mt-10 [&_h3]:mb-3 [&_h3]:font-display [&_h3]:text-xl [&_h3]:text-olive-dark",
  "[&_p]:my-5 [&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5",
  "[&_a]:text-olive [&_a]:underline [&_a]:underline-offset-4 [&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_blockquote]:my-8 [&_blockquote]:border-l-2 [&_blockquote]:border-olive [&_blockquote]:pl-6 [&_blockquote]:font-display [&_blockquote]:text-xl [&_blockquote]:text-olive-dark",
  "[&_code]:rounded [&_code]:bg-olive-50 [&_code]:px-1.5 [&_code]:text-[0.9em] [&_hr]:my-12 [&_hr]:border-line",
].join(" ");

export function ArticlePage({ view, preview }: { view: ArticleView; preview?: { status: string; version: number } }) {
  return (
    <div className="flex flex-1 flex-col bg-background">
      {preview ? <PreviewBanner {...preview} /> : null}
      <SiteHeader business={view.business} cta={view.cta} />
      <main className="flex-1">
        <article>
          <header className="border-b border-line bg-olive-50">
            <div className={`${container} max-w-4xl py-16 sm:py-24`}>
              <p className={`${eyebrow} text-muted`}>Garden advice</p>
              <h1 className="mt-5 font-display text-[2.2rem] leading-[1.1] text-olive-dark sm:text-5xl">{view.h1}</h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-foreground/75">{view.metaDescription}</p>
            </div>
          </header>
          <div className={`${container} max-w-4xl py-12 sm:py-16`}>
            <div className={`${prose} max-w-[68ch]`} dangerouslySetInnerHTML={{ __html: view.bodyHtml }} />
          </div>
          <Faqs faqs={view.faqs} title="Common questions" />
          <MoreLinks links={view.relatedProjects.map((p) => ({ text: p.title, url: p.url }))} />
        </article>
        <CtaBand cta={view.cta} area={null} heading="Thinking about your own garden?"
          body="Talk it through with the team who builds these gardens."
        />
      </main>
      <SiteFooter business={view.business} />
      <JsonLd graph={buildArticleJsonLd(view)} />
    </div>
  );
}
