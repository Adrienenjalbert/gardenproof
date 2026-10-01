import type { Metadata } from "next";
import { BusinessMark } from "@/components/owner/business-mark";
import { OIcon, type OwnerIconName } from "@/components/owner/icons";
import { TodayCards } from "@/components/owner/today-cards";
import { Group, Page, Row, RowDivider, SectionTitle } from "@/components/owner/ui";
import { getOwnerContext } from "@/lib/owner/tenant";
import { getToday } from "@/lib/owner/today";

export const metadata: Metadata = { title: "Today" };

const RECENT_ICON: Record<string, { icon: OwnerIconName; tint: string }> = {
  star: { icon: "star", tint: "#f5a623" },
  page: { icon: "globe", tint: "#0a84ff" },
  send: { icon: "send", tint: "#34c759" },
  flag: { icon: "sparkles", tint: "var(--accent)" },
};

export default async function TodayPage() {
  const [{ brand }, today] = await Promise.all([getOwnerContext(), getToday()]);
  return (
    <Page wide>
      <div className="flex items-center gap-2.5 pt-6 lg:hidden">
        <BusinessMark brand={brand} size={30} />
        <span className="truncate text-[15px] font-semibold text-(--ink)">{brand.name}</span>
      </div>
      <header className="mt-7 mb-6 lg:mt-0">
        <p className="text-[15px] font-medium text-(--ink2)">{today.date}</p>
        <h1 className="font-title mt-0.5 text-[32px] leading-[1.1] font-bold text-(--ink) lg:text-[40px]">
          {today.greeting}
        </h1>
      </header>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-10">
        <TodayCards cards={today.cards} />

        <aside className="lg:sticky lg:top-12">
          {today.wins && (
            <section className="mt-10 lg:mt-0">
              <SectionTitle>Working for you</SectionTitle>
              <Group>
                <div className="px-4 pt-3.5 pb-3">
                  <p className="text-[17px] font-semibold text-(--ink)">
                    {today.wins.total} {today.wins.total === 1 ? "enquiry" : "enquiries"} from your work online
                  </p>
                  <p className="mt-0.5 text-[14px] text-(--ink2)">In the last {today.wins.days} days, people enquired after seeing:</p>
                </div>
                {today.wins.top.map((w) => (
                  <div key={w.jobId ?? w.label}>
                    <RowDivider />
                    <Row
                      href={w.jobId ? `/jobs/${w.jobId}` : "/showcase"}
                      title={w.label}
                      subtitle={`via your ${w.via}`}
                      trailing={<span className="tabular-nums">{w.count}</span>}
                    />
                  </div>
                ))}
              </Group>
            </section>
          )}

          {today.upcoming.length > 0 && (
            <section className={today.wins ? "mt-10" : "mt-10 lg:mt-0"}>
              <SectionTitle>Coming up</SectionTitle>
              <div className="space-y-4">
                {today.upcoming.map((g) => (
                  <div key={g.team}>
                    <p className="mb-1.5 px-4 text-[13px] text-(--ink2)">
                      {g.team}
                      {g.lead ? ` · ${g.lead}` : ""}
                    </p>
                    <Group>
                      {g.items.map((it, i) => (
                        <div key={it.jobId}>
                          {i > 0 && <RowDivider />}
                          <Row
                            href={`/jobs/${it.jobId}`}
                            title={it.title}
                            subtitle={it.subtitle}
                            trailing={<span className="tabular-nums">{it.when}</span>}
                          />
                        </div>
                      ))}
                    </Group>
                  </div>
                ))}
              </div>
            </section>
          )}

          {today.recent.length > 0 && (
            <section className="mt-10">
              <SectionTitle>Recently</SectionTitle>
              <Group>
                {today.recent.map((r, i) => (
                  <div key={r.id}>
                    {i > 0 && <RowDivider inset={60} />}
                    <Row
                      href={r.href ?? undefined}
                      leading={
                        <span
                          className="grid size-[30px] shrink-0 place-items-center rounded-full text-white"
                          style={{ background: RECENT_ICON[r.icon].tint }}
                        >
                          <OIcon name={RECENT_ICON[r.icon].icon} size={16} strokeWidth={2} />
                        </span>
                      }
                      title={<span className="text-[16px]">{r.text}</span>}
                      trailing={<span className="text-[14px]">{r.when}</span>}
                      chevron={false}
                    />
                  </div>
                ))}
              </Group>
            </section>
          )}
        </aside>
      </div>
    </Page>
  );
}
