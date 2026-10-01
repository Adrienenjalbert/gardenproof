/** The week ahead: dated jobs grouped by day, plus what's on site right now (server-safe, no interaction). */
import type { WeekPlanner as WeekPlannerData } from "@/lib/owner/planner";
import { Empty, Group, Row, RowDivider } from "./ui";

export function WeekPlanner({ data }: { data: WeekPlannerData }) {
  const days = data.days.filter((d) => d.items.length > 0);
  if (!days.length && !data.onSite.length) {
    return (
      <Empty icon="calendar" title="Nothing booked this week">
        Site visits, start dates and maintenance visits will show up here as you book them in.
      </Empty>
    );
  }
  return (
    <div className="space-y-6">
      {data.onSite.length > 0 && (
        <section className="anim-rise">
          <p className="mb-1.5 px-4 text-[13px] text-(--ink2)">
            On site now <span className="text-(--ink3)">· {data.onSite.length}</span>
          </p>
          <Group>
            {data.onSite.map((j, i) => (
              <div key={j.jobId}>
                {i > 0 && <RowDivider inset={16} />}
                <Row
                  href={`/jobs/${j.jobId}`}
                  title={j.name}
                  subtitle={[j.area, `${j.team} team`].filter(Boolean).join(" · ")}
                  trailing={<span className="tabular-nums">{j.day <= 1 ? "Day 1" : `Day ${j.day}`}</span>}
                />
              </div>
            ))}
          </Group>
        </section>
      )}
      {days.map((day) => (
        <section key={day.key} className="anim-rise">
          <p className="mb-1.5 px-4 text-[13px] text-(--ink2)">
            {day.heading} <span className="text-(--ink3)">· {day.items.length}</span>
          </p>
          <Group>
            {day.items.map((it, i) => (
              <div key={it.jobId}>
                {i > 0 && <RowDivider inset={16} />}
                <Row
                  href={`/jobs/${it.jobId}`}
                  title={it.name}
                  subtitle={[it.area, it.service].filter(Boolean).join(" · ") || undefined}
                  trailing={<span className="tabular-nums">{it.time ?? "—"}</span>}
                />
              </div>
            ))}
          </Group>
        </section>
      ))}
    </div>
  );
}
