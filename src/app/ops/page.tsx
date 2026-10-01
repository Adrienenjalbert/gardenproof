import type { Metadata } from "next";
import { BackgroundWork } from "@/components/dashboard/background-work";
import { JobCard } from "@/components/dashboard/job-card";
import { NeedsYou } from "@/components/dashboard/needs-you";
import { PipelineStrip } from "@/components/dashboard/pipeline-strip";
import { TaskPoller } from "@/components/dashboard/task-poller";
import { Icon } from "@/components/ui/icons";
import { ButtonLink, Card, EmptyState, SectionHeader } from "@/components/ui/primitives";
import { overviewHeadline } from "@/lib/dashboard/logic";
import { getOverview } from "@/lib/dashboard/queries";

export const metadata: Metadata = { title: "Overview" };

function greeting(now: Date): string {
  const hour = Number(now.toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" }));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default async function OverviewPage() {
  const now = new Date();
  const data = await getOverview(now);
  const parts = overviewHeadline(data.counts);
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });

  return (
    <div className="space-y-10">
      <TaskPoller active={data.background.running + data.background.queued > 0} intervalMs={6000} />
      <header>
        <p className="mb-3 text-xs font-medium tracking-[0.12em] text-muted uppercase">
          {greeting(now)} · {date}
        </p>
        <h1 className="max-w-4xl text-balance font-display text-[24px] leading-[1.3] text-foreground sm:text-[30px]">
          {parts.map((p, i) => (
            <span key={p}>
              {i > 0 && <span className="px-2 text-stone-300">·</span>}
              <span className={i === 0 ? "" : "text-olive"}>{p}</span>
            </span>
          ))}
        </h1>
      </header>

      <section aria-labelledby="pipeline-h" className="space-y-3">
        <h2 id="pipeline-h" className="sr-only">
          Pipeline
        </h2>
        <PipelineStrip steps={data.pipeline} />
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <aside className="space-y-4 lg:order-2">
          <NeedsYou data={data} />
          <BackgroundWork bg={data.background} />
          <Card className="p-4">
            <h2 className="mb-3 font-display text-[17px]">Quick links</h2>
            <div className="grid gap-2">
              {[
                { href: "/simulator", icon: "phone" as const, title: "WhatsApp simulator", sub: "Capture a job as the crew would" },
                { href: "/portfolio", icon: "globe" as const, title: "Public portfolio", sub: "What homeowners see" },
              ].map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-line transition-colors hover:bg-olive-50 hover:ring-olive-100"
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-olive text-leaf">
                    <Icon name={l.icon} size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{l.title}</span>
                    <span className="block text-xs text-muted">{l.sub}</span>
                  </span>
                  <Icon name="external" size={14} className="text-stone-300 group-hover:text-olive" />
                </a>
              ))}
            </div>
          </Card>
        </aside>

        <section aria-labelledby="recent-h" className="space-y-4 lg:order-1">
          <SectionHeader
            title={<span id="recent-h">Recent jobs</span>}
            action={
              <ButtonLink href="/ops/jobs" variant="ghost" size="sm" iconRight="chevronRight">
                All jobs
              </ButtonLink>
            }
          />
          {data.recentJobs.length ? (
            <div className="grid gap-5 sm:grid-cols-2">
              {data.recentJobs.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </div>
          ) : (
            <EmptyState icon="image" title="No jobs yet">
              Jobs appear here as soon as a crew member sends their first photo on WhatsApp.
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}
