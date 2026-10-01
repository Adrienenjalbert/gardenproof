/* eslint-disable @next/next/no-img-element -- media is served by our own route */
/**
 * Filterable project grid (the prototype of the embeddable portfolio widget). Filters are plain links with
 * URL params, so they work without JavaScript and every filtered view is shareable.
 */
import Link from "next/link";
import type { ProjectCard } from "@/lib/publish/data";
import { eyebrow } from "./sections";

export type GridFilters = { service: string | null; area: string | null; drafts: boolean };

export function filterHref(current: GridFilters, change: Partial<GridFilters>): string {
  const next = { ...current, ...change };
  const q = new URLSearchParams();
  if (next.service) q.set("service", next.service);
  if (next.area) q.set("area", next.area);
  if (next.drafts) q.set("drafts", "1");
  const s = q.toString();
  return s ? `/portfolio?${s}` : "/portfolio";
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={`inline-flex items-center rounded-full border px-4 py-2 text-sm transition-colors ${
        active ? "border-olive bg-olive text-white" : "border-line bg-white text-foreground/80 hover:border-olive hover:text-olive"
      }`}
    >
      {children}
    </Link>
  );
}

export function FilterBar({
  label,
  options,
  selected,
  hrefFor,
}: {
  label: string;
  options: string[];
  selected: string | null;
  hrefFor: (value: string | null) => string;
}) {
  if (options.length < 2 && !selected) return null;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <p className={`${eyebrow} w-24 shrink-0 text-muted`} id={`filter-${label}`}>
        {label}
      </p>
      <ul aria-labelledby={`filter-${label}`} className="-mx-1 flex flex-wrap gap-2 px-1">
        <li>
          <Chip href={hrefFor(null)} active={!selected}>
            All
          </Chip>
        </li>
        {options.map((o) => (
          <li key={o}>
            <Chip href={hrefFor(o)} active={selected === o}>
              {o}
            </Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProjectCardView({ card, priority }: { card: ProjectCard; priority?: boolean }) {
  const draft = card.status !== "published";
  return (
    <li>
      <a href={card.url} className="group block focus-visible:outline-none">
        <div className="relative aspect-[4/3] overflow-hidden bg-olive-100 ring-olive ring-offset-4 group-focus-visible:ring-2">
          {card.image ? (
            <img
              src={card.image.src}
              alt={card.image.alt}
              loading={priority ? "eager" : "lazy"}
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            />
          ) : null}
          {draft ? (
            <span className="absolute top-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-olive-dark uppercase">
              {card.status === "approved" ? "Approved" : "In review"}
            </span>
          ) : null}
        </div>
        <p className={`${eyebrow} mt-5 text-muted`}>{[card.service, card.area].filter(Boolean).join(" · ")}</p>
        <h2 className="mt-2 font-display text-[1.35rem] leading-snug text-olive-dark decoration-olive/40 underline-offset-4 group-hover:underline">
          {card.title}
        </h2>
      </a>
    </li>
  );
}
