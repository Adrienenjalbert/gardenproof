/**
 * /portfolio — filterable grid of published projects (prototype of the embeddable portfolio widget).
 * `?drafts=1` also shows approved and in-review pages, but only to the signed-in operator (drafts may still
 * lack consent); for anyone else the flag is ignored.
 */
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/portfolio/chrome";
import { FilterBar, filterHref, ProjectCardView, type GridFilters } from "@/components/portfolio/ProjectGrid";
import { container, eyebrow } from "@/components/portfolio/sections";
import { env } from "@/lib/config";
import { viewerIsOperator } from "@/lib/publish/access";
import { DEMO_DRAFT_STATUSES, listProjectCards, PUBLIC_STATUSES } from "@/lib/publish/data";
import { businessRef } from "@/lib/publish/view";
import { getTenantBySlug } from "@/lib/tenants";

export async function generateMetadata(props: PageProps<"/portfolio">): Promise<Metadata> {
  const q = await props.searchParams;
  const tenant = await getTenantBySlug();
  const filtered = Object.keys(q).length > 0;
  return {
    title: { absolute: `Garden projects | ${tenant.config.name}` },
    description: `Finished gardens by ${tenant.config.name}: real photos, materials and homeowner reviews.`,
    // Filtered and draft views are duplicates / not public.
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const uniqueSorted = (values: (string | null)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "en-GB"));

export default async function PortfolioIndex(props: PageProps<"/portfolio">) {
  const q = await props.searchParams;
  const tenant = await getTenantBySlug();
  const filters: GridFilters = {
    service: one(q.service),
    area: one(q.area),
    drafts: one(q.drafts) === "1" && (await viewerIsOperator()),
  };
  const all = await listProjectCards(tenant, { statuses: filters.drafts ? DEMO_DRAFT_STATUSES : PUBLIC_STATUSES });
  const cards = all.filter(
    (c) => (!filters.service || c.service === filters.service) && (!filters.area || c.area === filters.area),
  );
  const business = businessRef(tenant.config, env.appUrl);

  return (
    <div className="flex flex-1 flex-col bg-background">
      <SiteHeader business={business} cta={tenant.config.cta} />
      <main className="flex-1">
        <header className={`${container} pt-16 pb-10 sm:pt-24 sm:pb-14`}>
          <p className={`${eyebrow} text-muted`}>Our work</p>
          <h1 className="mt-5 max-w-3xl font-display text-[2.4rem] leading-[1.08] text-olive-dark sm:text-6xl">
            Finished gardens, photographed as they are.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-foreground/75">
            Every project here is a real garden we designed and built, with the materials used and, where they agreed to
            share it, what the homeowner said.
          </p>
          {filters.drafts ? (
            <p className="mt-6 inline-block rounded-full bg-olive-50 px-4 py-2 text-sm text-olive-dark">
              Operator view: including pages that are approved or in review (not public).
            </p>
          ) : null}
        </header>

        <div className={container}>
          <div className="flex flex-col gap-4 border-y border-line py-6">
          <FilterBar
            label="Service"
            options={uniqueSorted(all.map((c) => c.service))}
            selected={filters.service}
            hrefFor={(service) => filterHref(filters, { service })}
          />
          <FilterBar
            label="Area"
            options={uniqueSorted(all.map((c) => c.area))}
            selected={filters.area}
            hrefFor={(area) => filterHref(filters, { area })}
          />
            <p className="text-sm text-muted" aria-live="polite">
              {cards.length} {cards.length === 1 ? "project" : "projects"}
            </p>
          </div>
        </div>

        <section aria-label="Projects" className={`${container} py-12 sm:py-16`}>
          {cards.length ? (
            <ul className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card, i) => (
                <ProjectCardView key={card.assetId} card={card} priority={i < 3} />
              ))}
            </ul>
          ) : (
            <div className="border border-dashed border-line px-6 py-20 text-center">
              <p className="font-display text-2xl text-olive-dark">No projects match these filters yet.</p>
              <a href="/portfolio" className="mt-4 inline-block text-olive underline underline-offset-4">
                Show all projects
              </a>
            </div>
          )}
        </section>
      </main>
      <SiteFooter business={business} />
    </div>
  );
}
