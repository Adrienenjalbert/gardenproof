/**
 * Type-specific, read-only previews of asset content. Content is parsed with the shared schemas;
 * anything that fails to parse falls back to raw JSON so the operator can still see and fix it.
 */
import type { ReactNode } from "react";
import type { Asset } from "@/db/schema";
import { ASSET_CONTENT_SCHEMAS, type AssetContentByType, type AssetType } from "@/lib/domain";
import { AD_LIMITS } from "@/lib/dashboard/logic";
import { publicUrl } from "@/lib/storage";
import { CharCounter } from "@/components/ui/char-counter";
import { Icon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/photo";
import { Badge, ButtonLink } from "@/components/ui/primitives";
import { MiniMarkdown } from "./mini-markdown";

type MediaUrls = Record<string, string>;

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">{children}</p>;
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Badge key={i} tone="olive">
          {i}
        </Badge>
      ))}
    </div>
  );
}

/** A list of copy lines each with a counter against a limit. */
function CopyRows({ title, rows, max, words }: { title: string; rows: string[]; max: number; words?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-[11px] text-muted">
          max {max}
          {words ? " words" : " chars"}
        </p>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-3 bg-white px-3 py-2 text-sm leading-snug">
            <span className="w-4 shrink-0 pt-px text-xs text-stone-400 tabular-nums">{i + 1}</span>
            <span className="flex-1">{r}</span>
            <CharCounter value={r} max={max} words={words} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PortfolioPreview({ asset, c, urls }: { asset: Asset; c: AssetContentByType["portfolio_page"]; urls: MediaUrls }) {
  const hero = c.gallery.find((g) => g.stage === "after") ?? c.gallery[0];
  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
        <Photo src={hero ? (urls[hero.mediaId] ?? null) : null} alt={hero?.alt ?? ""} className="aspect-[4/3] w-full rounded-xl" />
        <div className="min-w-0">
          <h4 className="font-display text-lg leading-snug">{c.h1}</h4>
          <p className="mt-2 text-sm leading-relaxed text-foreground/80">{c.summary}</p>
          <div className="mt-3">
            <Chips items={[...c.facts.materials, ...c.facts.features].slice(0, 8)} />
          </div>
        </div>
      </div>

      <div>
        <Label>Search result</Label>
        <div className="rounded-xl bg-white p-3.5 ring-1 ring-line">
          <p className="truncate text-xs text-stone-500">
            thorburnlandscapes.co.uk › projects › {c.slug}
          </p>
          <p className="mt-0.5 flex items-start justify-between gap-3 text-[17px] leading-snug text-[#1a0dab]">
            <span>{c.seoTitle}</span>
            <CharCounter value={c.seoTitle} max={65} />
          </p>
          <p className="mt-1 flex items-start justify-between gap-3 text-[13px] leading-snug text-stone-600">
            <span>{c.metaDescription}</span>
            <CharCounter value={c.metaDescription} max={160} />
          </p>
        </div>
      </div>

      {c.testimonial && (
        <blockquote className="rounded-xl bg-olive-50 px-4 py-3 text-sm">
          <p className="font-display leading-relaxed text-olive-dark">“{c.testimonial.quote}”</p>
          <footer className="mt-1 text-xs text-muted">
            {c.testimonial.attribution} · {"★".repeat(c.testimonial.rating)}
          </footer>
        </blockquote>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink href={`/preview/${asset.id}`} external size="sm" icon="eye">
          Open preview
        </ButtonLink>
        {asset.externalUrl && (
          <ButtonLink href={asset.externalUrl} external size="sm" variant="subtle" icon="external">
            Live page
          </ButtonLink>
        )}
      </div>
      <details className="group rounded-xl ring-1 ring-line">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-muted hover:text-foreground">
          <Icon name="chevronRight" size={14} className="transition-transform group-open:rotate-90" />
          Embedded page preview
        </summary>
        <iframe
          src={`/preview/${asset.id}`}
          title={`Preview of ${c.h1}`}
          loading="lazy"
          className="h-[640px] w-full rounded-b-xl border-t border-line bg-white"
        />
      </details>
    </div>
  );
}

function AdCopyPreview({ c }: { c: AssetContentByType["ad_copy"] }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Badge tone="olive">Angle: {c.angle}</Badge>
      </div>
      <section className="space-y-4">
        <Label>Meta · Facebook & Instagram</Label>
        <CopyRows title="On-video hooks" rows={c.meta.hooks} max={AD_LIMITS.metaHookWords} words />
        <CopyRows title="Primary texts" rows={c.meta.primaryTexts} max={AD_LIMITS.metaPrimaryText} />
        <CopyRows title="Headlines" rows={c.meta.headlines} max={AD_LIMITS.metaHeadline} />
      </section>
      <section className="space-y-4">
        <Label>Google Performance Max</Label>
        <CopyRows title="Headlines" rows={c.pmax.headlines} max={AD_LIMITS.pmaxHeadline} />
        <CopyRows title="Long headlines" rows={c.pmax.longHeadlines} max={AD_LIMITS.pmaxLongHeadline} />
        <CopyRows title="Descriptions" rows={c.pmax.descriptions} max={AD_LIMITS.pmaxDescription} />
      </section>
    </div>
  );
}

function SocialPreview({ c, urls }: { c: AssetContentByType["social_pack"]; urls: MediaUrls }) {
  return (
    <div className="space-y-5">
      <div>
        <Label>Carousel · {c.carouselOrder.length} slides</Label>
        <ol className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {c.carouselOrder.map((id, i) => (
            <li key={`${id}-${i}`} className="relative shrink-0">
              <Photo src={urls[id] ?? null} alt={`Slide ${i + 1}`} className="size-28 rounded-lg sm:size-32" />
              <span className="absolute top-1.5 left-1.5 rounded-full bg-black/55 px-1.5 text-[10px] leading-4 font-semibold text-white">
                {i + 1}
              </span>
              {i === 0 && c.reelCoverText && (
                <span className="absolute inset-x-1.5 bottom-1.5 rounded bg-white/90 px-1.5 py-0.5 text-[10px] leading-tight font-medium">
                  {c.reelCoverText}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <Label>Caption variants</Label>
        <ol className="space-y-2">
          {c.captions.map((cap, i) => (
            <li key={i} className="rounded-xl bg-white px-3.5 py-3 text-sm leading-relaxed ring-1 ring-line">
              <span className="mr-2 text-xs font-semibold text-olive">V{i + 1}</span>
              {cap}
            </li>
          ))}
        </ol>
      </div>
      <p className="text-sm text-sky-800">{c.hashtags.join(" ")}</p>
    </div>
  );
}

const CTA_LABEL = { BOOK: "Book", LEARN_MORE: "Learn more", CALL: "Call now" } as const;

function GbpPreview({ c, urls }: { c: AssetContentByType["gbp_post"]; urls: MediaUrls }) {
  return (
    <div className="max-w-sm overflow-hidden rounded-xl bg-white ring-1 ring-line">
      {c.mediaId && <Photo src={urls[c.mediaId] ?? null} alt="Post image" className="aspect-[4/3] w-full" />}
      <div className="p-4">
        <p className="text-sm leading-relaxed whitespace-pre-line">{c.text}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="rounded-full bg-sky-700 px-4 py-1.5 text-xs font-medium text-white">{CTA_LABEL[c.ctaType]}</span>
          <CharCounter value={c.text} max={1500} />
        </div>
        {c.ctaUrl && <p className="mt-2 truncate text-xs text-muted">{c.ctaUrl}</p>}
      </div>
    </div>
  );
}

const RATIO_CLASS = { "9:16": "aspect-[9/16] w-52", "1:1": "aspect-square w-72", "16:9": "aspect-video w-full max-w-lg" } as const;

function VideoPreview({ asset, c }: { asset: Asset; c: AssetContentByType["video"] }) {
  const poster = asset.thumbnailKey ? publicUrl(asset.thumbnailKey) : undefined;
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div className={`relative shrink-0 overflow-hidden rounded-xl bg-olive-dark ${RATIO_CLASS[c.ratio]}`}>
        {asset.fileKey ? (
          <video src={publicUrl(asset.fileKey)} poster={poster} controls playsInline preload="metadata" className="size-full object-cover" />
        ) : (
          <>
            {poster && <Photo src={poster} alt="" className="size-full opacity-50" />}
            <span className="absolute inset-0 grid place-items-center text-center text-xs font-medium text-white">
              <span>
                <Icon name="film" size={22} className="mx-auto mb-1.5" />
                Not rendered yet
              </span>
            </span>
          </>
        )}
      </div>
      <dl className="min-w-0 flex-1 space-y-3 text-sm">
        <div>
          <Label>Hook</Label>
          <p className="flex items-start justify-between gap-3 font-display text-lg leading-snug">
            {c.hook} <CharCounter value={c.hook} max={AD_LIMITS.metaHookWords} words />
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="olive">Template: {c.template}</Badge>
          <Badge tone="neutral">{c.ratio}</Badge>
          {c.durationSec && <Badge tone="neutral">{c.durationSec}s</Badge>}
        </div>
      </dl>
    </div>
  );
}

function ArticlePreview({ c }: { c: AssetContentByType["seo_article"] }) {
  const excerpt = c.bodyMarkdown.length > 900 ? `${c.bodyMarkdown.slice(0, 900)}…` : c.bodyMarkdown;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="olive" icon="flag">
          {c.targetKeyword}
        </Badge>
      </div>
      <h4 className="font-display text-xl leading-snug">{c.h1}</h4>
      <div className="relative max-h-80 overflow-hidden rounded-xl bg-white p-4 ring-1 ring-line">
        <MiniMarkdown source={excerpt} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white" />
      </div>
    </div>
  );
}

export function AssetPreview({ asset, mediaUrls }: { asset: Asset; mediaUrls: MediaUrls }) {
  const parsed = ASSET_CONTENT_SCHEMAS[asset.type as AssetType].safeParse(asset.content);
  if (!parsed.success) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm text-red-700">
          <Icon name="alert" size={15} /> Content doesn&apos;t match the {asset.type} format — fix it in advanced JSON.
        </p>
        <pre className="max-h-64 overflow-auto rounded-xl bg-stone-50 p-3 text-xs">{JSON.stringify(asset.content, null, 2)}</pre>
      </div>
    );
  }
  const d = parsed.data;
  switch (asset.type) {
    case "portfolio_page":
      return <PortfolioPreview asset={asset} c={d as AssetContentByType["portfolio_page"]} urls={mediaUrls} />;
    case "ad_copy":
      return <AdCopyPreview c={d as AssetContentByType["ad_copy"]} />;
    case "social_pack":
      return <SocialPreview c={d as AssetContentByType["social_pack"]} urls={mediaUrls} />;
    case "gbp_post":
      return <GbpPreview c={d as AssetContentByType["gbp_post"]} urls={mediaUrls} />;
    case "video":
      return <VideoPreview asset={asset} c={d as AssetContentByType["video"]} />;
    case "seo_article":
      return <ArticlePreview c={d as AssetContentByType["seo_article"]} />;
  }
}
