import type { Metadata } from "next";
import { BadgeLogo } from "@/components/owner/badge-logo";
import { BusinessMark } from "@/components/owner/business-mark";
import { OIcon } from "@/components/owner/icons";
import { OutputsForm } from "@/components/owner/settings-forms";
import {
  BackLink,
  ButtonLink,
  Empty,
  Group,
  GroupLabel,
  LargeTitle,
  Page,
  Row,
  RowDivider,
} from "@/components/owner/ui";
import { providerName } from "@/lib/owner/showcase-words";
import { readSettings } from "@/lib/crm-engine/settings";
import { getOwnerContext } from "@/lib/owner/tenant";

export const metadata: Metadata = { title: "Your business" };

export default async function BusinessPage() {
  const { tenant, brand } = await getOwnerContext();
  const p = tenant.profile;
  return (
    <Page>
      <div className="pt-3 lg:hidden">
        <BackLink href="/more" label="More" />
      </div>
      <LargeTitle title="Your business" />
      {!p ? (
        <Empty
          icon="store"
          title="We haven't read your website yet"
          action={
            <ButtonLink href="/start" size="lg">
              Set up from your website
            </ButtonLink>
          }
        >
          It takes a minute: we find your logo, services, reviews and badges, and you check them.
        </Empty>
      ) : (
        <div className="space-y-8">
          <Group>
            <div className="flex flex-col items-center px-5 pt-7 pb-6 text-center">
              <BusinessMark brand={brand} size={84} className="rounded-[20px]" />
              <p className="font-title mt-4 text-[24px] font-bold text-(--ink)">{p.name}</p>
              {p.tagline && <p className="mt-1 text-[15px] text-(--ink2)">{p.tagline}</p>}
              <div className="mt-4 flex gap-2.5">
                {[p.brand.colors.primary, p.brand.colors.secondary, p.brand.colors.accent]
                  .filter((c, n, all): c is string => !!c && all.indexOf(c) === n)
                  .map((c) => (
                    <span key={c} className="size-8 rounded-full ring-1 ring-black/10" style={{ background: c }} />
                  ))}
              </div>
            </div>
            {p.contact.phone && (
              <>
                <RowDivider />
                <Row title="Phone" trailing={p.contact.phone} chevron={false} />
              </>
            )}
            {p.contact.email && (
              <>
                <RowDivider />
                <Row title="Email" trailing={p.contact.email} chevron={false} />
              </>
            )}
          </Group>

          <div>
            <GroupLabel>Services</GroupLabel>
            <div className="flex flex-wrap gap-2 px-1">
              {p.services.map((s) => (
                <span
                  key={s.key}
                  className="rounded-full bg-(--card) px-3.5 py-2 text-[15px] text-(--ink) shadow-(--shadow)"
                >
                  {s.label}
                </span>
              ))}
            </div>
          </div>

          <div>
            <GroupLabel>Areas</GroupLabel>
            <div className="flex flex-wrap gap-2 px-1">
              {p.areas.map((a) => (
                <span
                  key={a.name}
                  className="rounded-full bg-(--card) px-3.5 py-2 text-[15px] text-(--ink) shadow-(--shadow)"
                >
                  {a.name}
                </span>
              ))}
            </div>
          </div>

          <div>
            <GroupLabel>Badges</GroupLabel>
            <Group>
              {p.badges.map((b, i) => (
                <div key={b.name}>
                  {i > 0 && <RowDivider inset={60} />}
                  <Row
                    href={b.profileUrl ?? undefined}
                    external
                    leading={<BadgeLogo imageKey={b.imageKey} imageUrl={b.imageUrl} verified={b.verified} size={34} />}
                    title={b.name}
                    subtitle={b.verified ? "Confirmed · shown on your pages and ads" : "Not confirmed · not shown"}
                    chevron={!!b.profileUrl}
                  />
                </div>
              ))}
            </Group>
          </div>

          <OutputsForm initial={readSettings(tenant).outputs} />

          {p.reviews.sources.length > 0 && (
            <div>
              <GroupLabel>Reviews online</GroupLabel>
              <Group>
                {p.reviews.sources.map((s, i) => (
                  <div key={s.url}>
                    {i > 0 && <RowDivider />}
                    <Row
                      href={s.url}
                      external
                      title={providerName(s.provider)}
                      trailing={
                        s.rating !== null
                          ? `★ ${s.rating.toFixed(1)}${s.count !== null ? ` · ${s.count}` : ""}`
                          : "No rating shown"
                      }
                    />
                  </div>
                ))}
              </Group>
            </div>
          )}

          <ButtonLink href={`/start?url=${encodeURIComponent(p.source.url)}`} variant="tinted" size="lg" full>
            <OIcon name="swap" size={19} /> Refresh from website
          </ButtonLink>
          <p className="-mt-5 text-center text-[13px] text-(--ink3)">
            Last read{" "}
            {new Date(p.source.scrapedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      )}
    </Page>
  );
}
