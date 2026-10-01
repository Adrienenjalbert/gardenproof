import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/dashboard/action-button";
import { AssetCard } from "@/components/dashboard/asset-card";
import { ConsentBanner } from "@/components/dashboard/consent-banner";
import { JobMedia } from "@/components/dashboard/job-media";
import { JobStory } from "@/components/dashboard/job-story";
import { JobTestimonial } from "@/components/dashboard/job-testimonial";
import { TaskLines } from "@/components/dashboard/task-status";
import { TaskPoller } from "@/components/dashboard/task-poller";
import { Icon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/photo";
import { EmptyState, Tabs } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status-pill";
import { env } from "@/lib/config";
import { runContentGenerationAction } from "@/lib/dashboard/actions";
import { consentBlockers, formatDate } from "@/lib/dashboard/logic";
import { hasActiveWork } from "@/lib/dashboard/task-view";
import { getJobDetail } from "@/lib/dashboard/queries";

const TABS = ["assets", "media", "story", "testimonial"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: PageProps<"/ops/jobs/[id]">): Promise<Metadata> {
  const detail = await getJobDetail((await params).id);
  return { title: detail?.card.title ?? "Job" };
}

export default async function JobPage({ params, searchParams }: PageProps<"/ops/jobs/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const detail = await getJobDetail(id);
  if (!detail) notFound();
  const { job, card, assets, media, testimonial, customer, tasks, consent } = detail;

  const requested = typeof sp.tab === "string" ? sp.tab : "";
  const tab: Tab = (TABS as readonly string[]).includes(requested) ? (requested as Tab) : assets.length ? "assets" : "media";
  const mediaUrls = Object.fromEntries(media.map((m) => [m.id, m.url]));
  const inReview = assets.filter((a) => a.status === "in_review" && !consentBlockers(a.checks).length).length;
  const blockedCount = assets.filter((a) => a.status === "in_review" && consentBlockers(a.checks).length).length;
  const canGenerate = job.status !== "capturing";
  const jobTasks = tasks.filter((t) => !t.assetId);
  const generating = jobTasks.some((t) => t.type === "pipeline.ready_for_content" && t.status !== "failed");
  const assetTasks = (assetId: string) => tasks.filter((t) => t.assetId === assetId);
  const banner = consent && (
    <ConsentBanner jobId={job.id} block={consent} blockedCount={blockedCount} safeMode={env.safeMode} />
  );

  return (
    <div className="space-y-8">
      <TaskPoller active={hasActiveWork(tasks)} />
      <Link href="/ops/jobs" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <Icon name="chevronLeft" size={15} /> Jobs
      </Link>

      <header className="relative overflow-hidden rounded-3xl bg-olive-dark">
        <Photo src={card.coverUrl} alt={card.title} className="aspect-[4/3] w-full opacity-90 sm:aspect-[21/8]" />
        <div className="absolute inset-0 bg-gradient-to-t from-olive-dark via-olive-dark/35 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-4 p-5 sm:p-8">
          <div className="min-w-0 text-white">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusPill kind="job" status={job.status} className="bg-white/95" />
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 font-mono text-xs backdrop-blur">{job.code}</span>
            </div>
            <h1 className="font-display text-[24px] leading-tight sm:text-[34px]">{card.title}</h1>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/80">
              {card.serviceLabel && <span>{card.serviceLabel}</span>}
              {job.area && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="pin" size={14} /> {job.area}
                </span>
              )}
              {card.crewName && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="user" size={14} /> {card.crewName}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Icon name="clock" size={14} /> {job.completedAt ? `Finished ${formatDate(job.completedAt)}` : `Started ${formatDate(job.startedAt)}`}
              </span>
              {customer?.optedOut && <span className="font-medium text-amber-300">Customer opted out of messages</span>}
            </p>
          </div>
          {canGenerate && (
            <ActionButton
              action={runContentGenerationAction.bind(null, job.id)}
              variant="secondary"
              icon="wand"
              pendingLabel="Queuing…"
              disabled={generating}
              title={generating ? "Content generation is already running" : undefined}
              confirm={assets.length ? "Generate content again? New drafts will be created for review." : undefined}
            >
              {generating ? "Generating…" : assets.length ? "Re-run content generation" : "Run content generation"}
            </ActionButton>
          )}
        </div>
      </header>

      {jobTasks.length > 0 && <TaskLines tasks={jobTasks} />}

      <Tabs
        active={tab}
        items={[
          { key: "assets", label: "Assets", href: `/ops/jobs/${id}?tab=assets`, count: assets.length },
          { key: "media", label: "Media", href: `/ops/jobs/${id}?tab=media`, count: media.length },
          { key: "story", label: "Story", href: `/ops/jobs/${id}?tab=story` },
          { key: "testimonial", label: "Testimonial", href: `/ops/jobs/${id}?tab=testimonial` },
        ]}
      />

      {tab === "assets" && banner}
      {tab === "assets" &&
        (assets.length ? (
          <div className="space-y-6">
            {inReview > 0 && (
              <p className="text-sm text-muted">
                {inReview} of {assets.length} waiting for your review. Approving queues publishing; progress shows on
                each card.
              </p>
            )}
            {assets.map((a) => (
              <AssetCard key={a.id} asset={a} mediaUrls={mediaUrls} tasks={assetTasks(a.id)} />
            ))}
          </div>
        ) : (
          <EmptyState icon="wand" title="No assets yet">
            {canGenerate
              ? "Run content generation to draft the portfolio page, ads, social pack, GBP post and videos."
              : "Content is generated once the crew finishes capturing."}
          </EmptyState>
        ))}
      {tab === "media" && <JobMedia media={media} />}
      {tab === "story" && <JobStory detail={detail} />}
      {tab === "testimonial" && (
        <>
          {banner}
          <JobTestimonial
            t={testimonial}
            area={job.area}
            firstName={customer?.firstName ?? null}
            businessName={detail.tenantConfig.name}
            history={detail.consentEvents}
            hasCustomer={!!customer}
          />
        </>
      )}
    </div>
  );
}
