/* eslint-disable @next/next/no-img-element -- tenant logo is a small static file */
/** Page chrome for public pages: site header, preview banner, footer and the JSON-LD tag. */
import Link from "next/link";
import type { JsonLdGraph } from "@/lib/publish/jsonld";
import { serializeJsonLd } from "@/lib/publish/jsonld";
import type { BusinessRef } from "@/lib/publish/view";

export function SiteHeader({ business, cta }: { business: BusinessRef; cta: { text: string; url: string } }) {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <a href={business.url} className="flex items-center gap-3" aria-label={`${business.name} home`}>
          {business.logo ? (
            <img src={business.logo} alt="" width={140} height={140} className="h-14 w-14 object-contain" />
          ) : null}
          <span className="hidden font-display text-lg tracking-wide text-olive-dark sm:inline">{business.name}</span>
        </a>
        <nav aria-label="Main" className="flex items-center gap-2 text-sm sm:gap-6">
          <Link href="/portfolio" className="rounded-full px-3 py-2 text-foreground/80 hover:text-olive">
            Projects
          </Link>
          <a
            href={cta.url}
            className="hidden rounded-full border border-olive px-5 py-2.5 font-medium text-olive transition-colors hover:bg-olive hover:text-white sm:inline-block"
          >
            {cta.text}
          </a>
        </nav>
      </div>
    </header>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: "draft",
  in_review: "in review",
  approved: "approved, not yet published",
  rejected: "rejected",
};

export function PreviewBanner({ status, version }: { status: string; version: number }) {
  return (
    <div role="note" className="bg-olive-dark px-5 py-2 text-center text-xs tracking-wide text-white/90">
      <span className="font-semibold text-white">Preview</span> — {STATUS_LABEL[status] ?? status} v{version} · not
      public
    </div>
  );
}

export function SiteFooter({ business }: { business: BusinessRef }) {
  return (
    <footer className="bg-olive-dark text-white/75">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-14 text-sm sm:flex-row sm:items-end sm:justify-between sm:px-8">
        <div>
          <p className="font-display text-2xl text-white">{business.name}</p>
          <p className="mt-2 max-w-sm leading-relaxed">Garden design and landscaping, shown with real finished work.</p>
        </div>
        <nav aria-label="Footer" className="flex gap-6">
          <Link href="/portfolio" className="hover:text-white">
            Projects
          </Link>
          <a href={business.url} className="hover:text-white">
            Website
          </a>
        </nav>
      </div>
    </footer>
  );
}

export function JsonLd({ graph }: { graph: JsonLdGraph }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }} />;
}
