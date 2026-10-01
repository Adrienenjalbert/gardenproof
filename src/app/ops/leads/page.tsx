import type { Metadata } from "next";
import Link from "next/link";
import { ASSET_TYPE_META } from "@/components/dashboard/asset-meta";
import { Icon } from "@/components/ui/icons";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import type { TouchView } from "@/lib/dashboard/lead-attribution";
import { formatDate, pluralise } from "@/lib/dashboard/logic";
import { getLeads, type LeadView } from "@/lib/dashboard/queries";
import { serviceLabel, type TenantConfig } from "@/lib/tenant";
import { getTenantBySlug } from "@/lib/tenants";

export const metadata: Metadata = { title: "Leads" };

const DAYS = 90;

function Dash() {
  return <span className="text-stone-300">—</span>;
}

/** First touch falls back to the flat columns for leads captured before `attribution` existed. */
function firstTouch(l: LeadView): TouchView | null {
  if (l.firstTouch) return l.firstTouch;
  if (!l.source && !l.landingPage) return null;
  return { source: l.source, medium: l.medium, campaign: l.campaign, content: l.content, landingPage: l.landingPage, referrer: l.referrer, at: null };
}

function Touch({ t, compact }: { t: TouchView | null; compact?: boolean }) {
  if (!t) return <Dash />;
  return (
    <span className="block min-w-0">
      <span className="capitalize">{t.source ?? "direct"}</span>
      <span className="text-muted"> / {t.medium ?? "—"}</span>
      {t.campaign && <span className="block truncate text-xs text-muted">{t.campaign}</span>}
      {!compact && t.landingPage && (
        <span className="block max-w-48 truncate font-mono text-[11px] text-muted" title={t.landingPage}>
          {t.landingPage}
        </span>
      )}
    </span>
  );
}

function sameTouch(a: TouchView | null, b: TouchView | null): boolean {
  return !!a && !!b && a.source === b.source && a.medium === b.medium && a.campaign === b.campaign && a.landingPage === b.landingPage;
}

function Credit({ l }: { l: LeadView }) {
  if (l.attributed) {
    const meta = ASSET_TYPE_META[l.attributed.type];
    return (
      <span className="block min-w-0">
        <span className="inline-flex max-w-56 items-center gap-1.5 font-medium text-olive-dark">
          <Icon name={meta.icon} size={14} className="shrink-0 text-olive" />
          <span className="truncate">{l.attributed.label}</span>
        </span>
        <span className="block text-xs text-muted">
          {meta.label}
          {l.attributed.jobId && (
            <>
              {" · "}
              <Link href={`/ops/jobs/${l.attributed.jobId}?tab=assets#asset-${l.attributed.assetId}`} className="hover:text-foreground hover:underline">
                open
              </Link>
            </>
          )}
        </span>
      </span>
    );
  }
  if (l.project) {
    return (
      <Link href={l.project.previewUrl} target="_blank" className="inline-flex max-w-56 items-center gap-1 text-olive hover:underline">
        <Icon name="doc" size={14} className="shrink-0" />
        <span className="truncate">{l.project.title}</span>
        <Icon name="external" size={12} className="shrink-0" />
      </Link>
    );
  }
  if (l.fromPortfolio) return <Badge tone="olive">Portfolio page</Badge>;
  return <span className="text-xs text-muted">Not traced</span>;
}

export default async function LeadsPage() {
  const [{ leads, summary, breakdown, breakdownText }, tenant] = await Promise.all([getLeads(DAYS), getTenantBySlug()]);
  const config = tenant.config as TenantConfig;
  const maxSource = Math.max(1, ...summary.bySource.map((s) => s.count));
  const maxKind = Math.max(1, ...breakdown.map((b) => b.count));
  const fromPortfolio = leads.filter((l) => l.fromPortfolio).length;
  const share = leads.length ? Math.round((fromPortfolio / leads.length) * 100) : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Leads"
        title={
          summary.total ? (
            <>
              {pluralise(summary.total, "enquiry", "enquiries")}
              <span className="text-stone-300"> · </span>
              <span className="text-olive">{share}% saw real work first</span>
            </>
          ) : (
            "Lead log"
          )
        }
        description={
          summary.total
            ? `${breakdownText}. Last ${DAYS} days, credited from ad links (utm_content) and the pages people viewed.`
            : `Website enquiries from the last ${DAYS} days, with where they came from and which content they saw.`
        }
      />

      {summary.total > 0 && (
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card className="flex flex-col justify-between p-5">
            <p className="text-[11px] font-medium tracking-[0.1em] text-muted uppercase">Saw real work first</p>
            <p className="mt-2 font-display text-[40px] leading-none text-olive-dark tabular-nums">{share}%</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-olive-50" aria-hidden>
              <div className="h-full rounded-full bg-olive" style={{ width: `${share}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted">
              {fromPortfolio} of {leads.length} viewed a project or came from one of our ads.
            </p>
          </Card>
          <Card className="p-5">
            <p className="mb-3 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">By content</p>
            <ul className="space-y-2.5">
              {breakdown.map((b) => (
                <li key={b.kind} className="grid grid-cols-[150px_minmax(0,1fr)_28px] items-center gap-3 text-sm">
                  <span className={b.kind === "none" ? "truncate text-muted first-letter:uppercase" : "truncate first-letter:uppercase"}>{b.label}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-olive-50" aria-hidden>
                    <span
                      className={b.kind === "none" ? "block h-full rounded-full bg-stone-300" : "block h-full rounded-full bg-olive"}
                      style={{ width: `${(b.count / maxKind) * 100}%` }}
                    />
                  </span>
                  <span className="text-right text-muted tabular-nums">{b.count}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5">
            <p className="mb-3 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">By first-touch source</p>
            <ul className="space-y-2.5">
              {summary.bySource.map((s) => (
                <li key={s.source} className="grid grid-cols-[90px_minmax(0,1fr)_28px] items-center gap-3 text-sm">
                  <span className="truncate capitalize">{s.source}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-olive-50" aria-hidden>
                    <span className="block h-full rounded-full bg-leaf" style={{ width: `${(s.count / maxSource) * 100}%` }} />
                  </span>
                  <span className="text-right text-muted tabular-nums">{s.count}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {leads.length ? (
        <Card className="overflow-hidden">
          {/* Table on desktop */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-[#fbfaf5] text-[11px] tracking-[0.08em] text-muted uppercase">
                <tr>
                  {["Date", "Enquiry", "Credited to", "First touch", "Last touch"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {leads.map((l) => {
                  const first = firstTouch(l);
                  return (
                    <tr key={l.id} className="align-top hover:bg-stone-50/60">
                      <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDate(l.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span className="block font-medium whitespace-nowrap">{l.name ?? "Unnamed"}</span>
                        <span className="block text-xs text-muted">
                          {l.service ? serviceLabel(l.service, config) : "—"} ·{" "}
                          <span className="font-mono">{l.postcode ?? "—"}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Credit l={l} />
                        {l.attributed && l.project && l.attributed.type !== "portfolio_page" && (
                          <Link href={l.project.previewUrl} target="_blank" className="mt-1 block max-w-56 truncate text-xs text-olive hover:underline">
                            Project: {l.project.title}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Touch t={first} />
                      </td>
                      <td className="px-4 py-3">
                        {sameTouch(first, l.lastTouch) ? (
                          <span className="text-xs text-muted">Same as first</span>
                        ) : l.lastTouch ? (
                          <Touch t={l.lastTouch} />
                        ) : (
                          <span className="text-xs text-muted">Not recorded</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Stacked list on phones and tablets */}
          <ul className="divide-y divide-line lg:hidden">
            {leads.map((l) => {
              const first = firstTouch(l);
              return (
                <li key={l.id} className="space-y-2 px-4 py-3.5 text-sm">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{l.name ?? "Unnamed"}</span>
                    <span className="text-xs text-muted">{formatDate(l.createdAt)}</span>
                  </p>
                  <p className="text-muted">
                    {l.service ? serviceLabel(l.service, config) : "—"} · <span className="font-mono text-xs">{l.postcode ?? "—"}</span>
                  </p>
                  <Credit l={l} />
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="mb-0.5 text-[10.5px] tracking-[0.08em] text-muted uppercase">First touch</p>
                      <Touch t={first} compact />
                    </div>
                    <div>
                      <p className="mb-0.5 text-[10.5px] tracking-[0.08em] text-muted uppercase">Last touch</p>
                      {sameTouch(first, l.lastTouch) ? <span className="text-muted">Same</span> : <Touch t={l.lastTouch} compact />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <EmptyState icon="leads" title="No enquiries yet">
          Enquiries from the website contact form are logged here with their source and the content they saw.
        </EmptyState>
      )}
    </div>
  );
}
